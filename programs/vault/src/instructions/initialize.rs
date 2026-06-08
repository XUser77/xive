use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use crate::{Vault, VAULT_SEED, LP_XUSD_MINT_ADDRESS, LP_XUSD_DECIMALS };

#[derive(Accounts)]
pub struct Initialize<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED.as_bytes()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = signer,
        address = LP_XUSD_MINT_ADDRESS,
        mint::decimals = LP_XUSD_DECIMALS,
        mint::authority = vault,
        mint::freeze_authority = vault,
    )]
    pub lp_xusd_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,

}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.vault.bump = ctx.bumps.vault;

    Ok(())
}