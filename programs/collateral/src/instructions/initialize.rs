use anchor_lang::prelude::*;

use crate::{Collateral, COLLATERAL_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: collateral token mint passed through and stored; validation is seed-based relation.
    pub collateral_token_mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Collateral::INIT_SPACE,
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_token_mint.key().as_ref()],
        bump,
    )]
    pub collateral: Account<'info, Collateral>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let token_mint = ctx.accounts.collateral_token_mint.key();
    let collateral_key = ctx.accounts.collateral.key();
    let now = Clock::get()?.unix_timestamp;

    let collateral = &mut ctx.accounts.collateral;
    collateral.token_mint = token_mint;
    collateral.price = 0;
    collateral.price_updated_at = now;
    collateral.bump = ctx.bumps.collateral;

    msg!("Collateral created");
    msg!("Collateral token mint: {}", token_mint);
    msg!("Collateral PDA: {}", collateral_key);
    msg!("Initial price: {}", collateral.price);
    msg!("Price updated at: {}", collateral.price_updated_at);
    Ok(())
}

