use anchor_lang::prelude::*;

use crate::{Collateral, COLLATERAL_SEED};

#[derive(Accounts)]
pub struct UpdateCollateral<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: only used as address for collateral PDA derivation.
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Collateral::INIT_SPACE,
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump,
    )]
    pub collateral: Account<'info, Collateral>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<UpdateCollateral>,
    ltv: u64,
    liquidation_ltv: u64,
    price: u64,
    allowed: bool,
) -> Result<()> {
    let collateral = &mut ctx.accounts.collateral;

    collateral.mint = ctx.accounts.collateral_mint.key();
    collateral.bump = ctx.bumps.collateral;
    collateral.allowed = allowed;
    collateral.ltv = ltv;
    collateral.liquidation_ltv = liquidation_ltv;
    collateral.price = price;
    collateral.price_date = Clock::get()?.unix_timestamp;

    msg!(
        "Collateral updated: {} (allowed={}, ltv={}, liq_ltv={}, price={})",
        collateral.mint,
        allowed,
        ltv,
        liquidation_ltv,
        price,
    );
    Ok(())
}
