use anchor_lang::prelude::*;

use crate::{Xive, XIVE_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Xive::INIT_SPACE,
        seeds = [XIVE_SEED.as_bytes()],
        bump,
    )]
    pub xive: Account<'info, Xive>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.xive.bump = ctx.bumps.xive;
    msg!("Xive singleton initialized");
    Ok(())
}
