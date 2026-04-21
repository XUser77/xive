use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::{Vault, LP_VAULT_DECIMALS, LP_VAULT_MINT_SEED, VAULT_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED.as_bytes()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = payer,
        seeds = [LP_VAULT_MINT_SEED.as_bytes()],
        bump,
        mint::decimals = LP_VAULT_DECIMALS,
        mint::authority = vault,
        mint::freeze_authority = vault,
    )]
    pub lp_vault_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.vault.bump = ctx.bumps.vault;
    ctx.accounts.vault.lp_vault_mint = ctx.accounts.lp_vault_mint.key();
    ctx.accounts.vault.lp_vault_mint_bump = ctx.bumps.lp_vault_mint;
    msg!("Vault singleton initialized");
    msg!("LP vault mint: {}", ctx.accounts.lp_vault_mint.key());
    Ok(())
}
