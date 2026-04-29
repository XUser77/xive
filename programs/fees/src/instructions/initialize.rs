use anchor_lang::prelude::*;

use crate::{Fees, FEES_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Fees::INIT_SPACE,
        seeds = [FEES_SEED.as_bytes()],
        bump,
    )]
    pub fees: Account<'info, Fees>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let fees = &mut ctx.accounts.fees;
    fees.bump = ctx.bumps.fees;
    fees.lp_position_mint = Pubkey::default();
    fees.lp_whirlpool = Pubkey::default();
    msg!("Fees singleton initialized: {}", fees.key());
    Ok(())
}
