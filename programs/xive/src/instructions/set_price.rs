use anchor_lang::prelude::*;

use crate::{Collateral, Xive, COLLATERAL_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct SetPrice<'info> {

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        has_one = admin
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED.as_bytes(), collateral.mint.as_ref()],
        bump = collateral.bump
    )]
    pub collateral: Account<'info, Collateral>,

    #[account(mut)]
    pub admin: Signer<'info>,

}

pub fn handler(ctx: Context<SetPrice>, price: u64) -> Result<()> {
    ctx.accounts.collateral.price = price;
    ctx.accounts.collateral.price_date = Clock::get()?.unix_timestamp;
    Ok(())
}