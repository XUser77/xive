use anchor_lang::prelude::*;

use crate::{Xive, DEFAULT_COMMISSION_BPS, XIVE_SEED};

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
    let xive = &mut ctx.accounts.xive;
    xive.bump = ctx.bumps.xive;
    xive.commission_bps = DEFAULT_COMMISSION_BPS;
    msg!("Xive singleton initialized (commission_bps = {})", xive.commission_bps);
    Ok(())
}
