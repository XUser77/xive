use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Mint, Token, TokenAccount, TransferChecked};
use crate::{Vault, Xive, XIVE_SEED, XUSD_MINT_ADDRESS, USDC_MINT_ADDRESS, VaultError, SWAP_FEE };
use crate::constants::{VAULT_SEED, XIVE_PROGRAM_ID};
use xive::cpi::accounts::Mint as XiveMintAccounts;
use xive::program::Xive as XiveProgram;

#[derive(Accounts)]
pub struct BuyXusd<'info> {

    #[account(mut)]
    pub swapper: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
    )]
    pub xusd_mint: Box<Account<'info, Mint>>,

    #[account(
        address = USDC_MINT_ADDRESS
    )]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = swapper,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = swapper,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = swapper,
        associated_token::mint = xusd_mint,
        associated_token::authority = swapper,
    )]
    pub swapper_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = swapper,
    )]
    pub swapper_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        seeds::program = xive_program.key(),
    )]
    pub xive: Box<Account<'info, Xive>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

    pub xive_program: Program<'info, XiveProgram>,

}

pub fn buy_xusd(ctx: Context<BuyXusd>, amount: u64) -> Result<()> {
    require!(amount >= 10 * 1000, VaultError::UsdcAmountTooSmall);

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                mint: ctx.accounts.usdc_mint.to_account_info(),
                from: ctx.accounts.swapper_usdc_ata.to_account_info(),
                to: ctx.accounts.vault_usdc_ata.to_account_info(),
                authority: ctx.accounts.swapper.to_account_info(),
            }
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let fee = amount
        .checked_mul(SWAP_FEE as u64).ok_or(VaultError::MathOverflow)?
        .checked_div(10000).ok_or(VaultError::MathOverflow)?;

    let to_pay = amount.checked_sub(fee).ok_or(VaultError::MathOverflow)?;

    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED.as_bytes(),
        &[bump],
    ]];

    // The vault acts as peg keeper: if it doesn't hold enough XUSD to pay the
    // swapper, mint the shortfall from xive. xive::mint (signed by the vault PDA)
    // drives Xive.vault_balance negative — the vault is borrowing xUSD against
    // the USDC it just received, to be repaid in batches.
    let vault_xusd_balance = ctx.accounts.vault_xusd_ata.amount;
    if vault_xusd_balance < to_pay {
        let shortfall = to_pay.checked_sub(vault_xusd_balance).ok_or(VaultError::MathOverflow)?;
        xive::cpi::mint(
            CpiContext::new_with_signer(
                XIVE_PROGRAM_ID,
                XiveMintAccounts {
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
                mint: ctx.accounts.xusd_mint.to_account_info(),
                from: ctx.accounts.vault_xusd_ata.to_account_info(),
                to: ctx.accounts.swapper_xusd_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds
        ),
        to_pay,
        ctx.accounts.xusd_mint.decimals,
    )?;

    let vault_fee = fee.checked_div(5).ok_or(VaultError::MathOverflow)?;
    let vault = &mut ctx.accounts.vault;
    vault.xusd_assets = vault.xusd_assets.checked_add(vault_fee).ok_or(VaultError::MathOverflow)?;

    Ok(())

}