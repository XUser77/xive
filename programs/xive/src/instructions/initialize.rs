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
    let xive_key = ctx.accounts.xive.key();
    let xive = &mut ctx.accounts.xive;
    xive.admin = ctx.accounts.payer.key();
    xive.bump = ctx.bumps.xive;

    msg!("Xive singleton initialized");
    msg!("Xive account: {}", xive_key);
    Ok(())
}

