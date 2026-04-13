use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::{Collateral, Xive, COLLATERAL_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct AllowCollateral<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        has_one = admin,
    )]
    pub xive: Account<'info, Xive>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Collateral::INIT_SPACE,
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump,
    )]
    pub collateral: Account<'info, Collateral>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AllowCollateral>, ltv: u64, price: u64) -> Result<()> {
    let collateral = &mut ctx.accounts.collateral;

    collateral.mint = ctx.accounts.collateral_mint.key();
    collateral.bump = ctx.bumps.collateral;

    collateral.allowed = true;
    collateral.ltv = ltv;

    collateral.price = price;
    collateral.price_date = Clock::get()?.unix_timestamp;

    msg!("Collateral allowed: {}", collateral.mint);
    Ok(())
}
