use anchor_lang::prelude::*;

use crate::{Vault, VAULT_SEED};

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

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.vault.bump = ctx.bumps.vault;
    msg!("Vault singleton initialized");
    Ok(())
}
