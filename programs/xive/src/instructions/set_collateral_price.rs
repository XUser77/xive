use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::{COLLATERAL_SEED};
use crate::state::collateral::Collateral;

#[derive(Accounts)]
pub struct SetCollateralPrice<'info> {

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account()]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED.as_bytes(), mint.key().as_ref()],
        bump = collateral.bump,
    )]
    pub collateral: Account<'info, Collateral>,
}

pub fn set_collateral_price(ctx: Context<SetCollateralPrice>, price: u64) -> Result<()> {
    // TODO: Check authority

    ctx.accounts.collateral.price = price;
    ctx.accounts.collateral.price_date = Clock::get()?.unix_timestamp;

    Ok(())
}