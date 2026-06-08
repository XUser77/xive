use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Mint, Token, TokenAccount, TransferChecked};
use crate::{Vault, VAULT_SEED, XUSD_MINT_ADDRESS, USDC_MINT_ADDRESS, VaultError, SWAP_FEE };

#[derive(Accounts)]
pub struct BuyXusd<'info> {

    #[account(mut)]
    pub swapper: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

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
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = swapper,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = swapper,
        associated_token::mint = xusd_mint,
        associated_token::authority = swapper,
    )]
    pub swapper_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = swapper,
    )]
    pub swapper_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

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

    let vault = &mut ctx.accounts.vault;
    let bump = vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED.as_bytes(),
        &[bump],
    ]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                from: ctx.accounts.vault_xusd_ata.to_account_info(),
                to: ctx.accounts.swapper_xusd_ata.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds
        ),
        to_pay,
        ctx.accounts.xusd_mint.decimals,
    )?;

    let vault_fee = fee.checked_div(5).ok_or(VaultError::MathOverflow)?;
    vault.xusd_assets = vault.xusd_assets.checked_add(vault_fee).ok_or(VaultError::MathOverflow)?;

    Ok(())

}