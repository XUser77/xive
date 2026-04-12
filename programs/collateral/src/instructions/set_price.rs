use anchor_lang::prelude::*;

use crate::{Collateral, COLLATERAL_SEED};

#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: used only as PDA seed input; must match stored token mint.
    pub collateral_token_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_token_mint.key().as_ref()],
        bump = collateral.bump,
        constraint = collateral.token_mint == collateral_token_mint.key(),
    )]
    pub collateral: Account<'info, Collateral>,
}

pub fn handler(ctx: Context<SetPrice>, price: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let collateral = &mut ctx.accounts.collateral;
    collateral.price = price;
    collateral.price_updated_at = now;

    msg!("Collateral price updated");
    msg!("Collateral PDA: {}", collateral.key());
    msg!("New price: {}", collateral.price);
    msg!("Price updated at: {}", collateral.price_updated_at);
    Ok(())
}

