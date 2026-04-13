use anchor_lang::prelude::*;

use crate::{Collateral, COLLATERAL_SEED};

#[derive(Accounts)]
pub struct DisallowCollateral<'info> {
    pub payer: Signer<'info>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Xive>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(payer.key()),
    )]
    pub program_data: Account<'info, ProgramData>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED.as_bytes(), collateral.mint.as_ref()],
        bump = collateral.bump,
    )]
    pub collateral: Account<'info, Collateral>,
}

pub fn handler(ctx: Context<DisallowCollateral>) -> Result<()> {
    ctx.accounts.collateral.allowed = false;
    msg!("Collateral disallowed: {}", ctx.accounts.collateral.mint);
    Ok(())
}
