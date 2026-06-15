use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Mint, Burn, Token, TransferChecked};
use anchor_spl::token::TokenAccount;
use xive::cpi::accounts::Mint as XiveMint;
use xive::program::Xive as XiveProgram;
use crate::{Vault, Xive, XIVE_SEED, LP_XUSD_MINT_ADDRESS, XUSD_MINT_ADDRESS, USDC_MINT_ADDRESS, XIVE_PROGRAM_ID, VaultError };
use crate::instructions::utils::get_lp_xusd_price;
use crate::constants::VAULT_SEED;

#[derive(Accounts)]
pub struct Withdraw<'info> {

    #[account(mut)]
    pub investor: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        seeds::program = xive::ID
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        address = LP_XUSD_MINT_ADDRESS,
    )]
    pub lp_xusd_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
    )]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        address = USDC_MINT_ADDRESS
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = investor,
        associated_token::mint = xusd_mint,
        associated_token::authority = investor,
    )]
    pub investor_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = lp_xusd_mint,
        associated_token::authority = investor,
    )]
    pub investor_lp_xusd_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

    pub xive_program: Program<'info, XiveProgram>,

}

pub fn withdraw(ctx: Context<Withdraw>, lp_amount: u64, min_xusd_amount: u64) -> Result<()> {

    require!(lp_amount >= 100 * 1000, VaultError::WithdrawAmountTooSmall); // 100_000 => 0.1 LP

    let price = get_lp_xusd_price(
        &ctx.accounts.vault,
        &ctx.accounts.xive,
        &ctx.accounts.vault_usdc_ata,
        &ctx.accounts.vault_xusd_ata,
        &ctx.accounts.lp_xusd_mint,
    )?;

    let xusd_amount = (lp_amount as u128)
        .checked_mul(price as u128).ok_or(VaultError::MathOverflow)?
        .checked_div(1000 * 1000).ok_or(VaultError::MathOverflow)?;

    require!(xusd_amount > 0, VaultError::XusdAmountTooSmall);
    let xusd_amount = u64::try_from(xusd_amount).map_err(|_| VaultError::MathOverflow)?;
    require!(xusd_amount >= min_xusd_amount, VaultError::SlippageExceeded);

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.lp_xusd_mint.to_account_info(),
                from: ctx.accounts.investor_lp_xusd_ata.to_account_info(),
                authority: ctx.accounts.investor.to_account_info(),
            }
        ),
        lp_amount,
    )?;

    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED.as_bytes(),
        &[bump],
    ]];

    // The vault always pays redemptions in xUSD, but its xUSD reserve can be
    // drained by swaps (buy_xusd). If on-hand xUSD is short, borrow the
    // difference from xive by minting it. This is NAV-neutral: the minted xUSD
    // raises vault_xusd_ata while xive.vault_balance drops by the same amount.
    let on_hand = ctx.accounts.vault_xusd_ata.amount;
    if xusd_amount > on_hand {
        let shortfall = xusd_amount.checked_sub(on_hand).ok_or(VaultError::MathOverflow)?;

        xive::cpi::mint(
            CpiContext::new_with_signer(
                XIVE_PROGRAM_ID,
                XiveMint {
                    signer: ctx.accounts.vault.to_account_info(),
                    xive: ctx.accounts.xive.to_account_info(),
                    xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                    signer_ata: ctx.accounts.vault_xusd_ata.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
                },
                signer_seeds,
            ),
            shortfall,
        )?;
    }

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_xusd_ata.to_account_info(),
                to: ctx.accounts.investor_xusd_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.xusd_mint.to_account_info(),
            },
            signer_seeds,
        ),
        xusd_amount,
        ctx.accounts.xusd_mint.decimals,
    )?;

    Ok(())

}
