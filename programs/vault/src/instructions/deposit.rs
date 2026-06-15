use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Mint, MintTo, Token, TransferChecked};
use anchor_spl::token::TokenAccount;
use crate::{Vault, Xive, XIVE_SEED, LP_XUSD_MINT_ADDRESS, XUSD_MINT_ADDRESS, USDC_MINT_ADDRESS, VaultError };
use crate::constants::VAULT_SEED;
use crate::instructions::utils::get_lp_xusd_price;

#[derive(Accounts)]
pub struct Deposit<'info> {

    #[account(mut)]
    pub investor: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
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
        address = XUSD_MINT_ADDRESS,
    )]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        address = USDC_MINT_ADDRESS
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
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
        init_if_needed,
        payer = investor,
        associated_token::mint = lp_xusd_mint,
        associated_token::authority = investor,
    )]
    pub investor_lp_xusd_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

}

pub fn deposit(ctx: Context<Deposit>, xusd_amount: u64, min_lp_amount: u64) -> Result<()> {

    require!(xusd_amount >= 100 * 1000, VaultError::DepositAmountTooSmall); // 100_000 => 0.1 XUSD

    let price = get_lp_xusd_price(
        &ctx.accounts.vault,
        &ctx.accounts.xive,
        &ctx.accounts.vault_usdc_ata,
        &ctx.accounts.vault_xusd_ata,
        &ctx.accounts.lp_xusd_mint,
    )?;

    let lp_amount = (xusd_amount as u128)
        .checked_mul(1000 * 1000).ok_or(VaultError::MathOverflow)?
        .checked_div(price as u128).ok_or(VaultError::MathOverflow)?;

    require!(lp_amount > 0, VaultError::LPAmountTooSmall);
    let lp_amount = u64::try_from(lp_amount).map_err(|_| VaultError::MathOverflow)?;
    require!(lp_amount >= min_lp_amount, VaultError::SlippageExceeded);

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.investor_xusd_ata.to_account_info(),
                to: ctx.accounts.vault_xusd_ata.to_account_info(),
                authority: ctx.accounts.investor.to_account_info(),
                mint: ctx.accounts.xusd_mint.to_account_info(),
            }
        ),
        xusd_amount,
        ctx.accounts.xusd_mint.decimals,
    )?;

    let vault = &ctx.accounts.vault;
    let bump = vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED.as_bytes(),
        &[bump],
    ]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.lp_xusd_mint.to_account_info(),
                to: ctx.accounts.investor_lp_xusd_ata.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds,
        ),
        lp_amount,
    )?;

    Ok(())

}