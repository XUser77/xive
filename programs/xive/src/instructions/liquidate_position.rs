use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::{Position, POSITION_SEED, PRICE_TIMEOUT, COLLATERAL_SEED, XIVE_SEED, VAULT_ADDRESS };
use crate::errors::XiveError;
use crate::state::collateral::Collateral;
use crate::state::xive::Xive;
use crate::utils::get_position_bps;

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED.as_bytes(), position.borrower.key().as_ref(), position.index.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump = collateral.bump,
    )]
    pub collateral: Account<'info, Collateral>,

    #[account(
        mut,
        address = position.collateral_mint
    )]
    pub collateral_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

}

pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {

    require!(ctx.accounts.signer.key() == VAULT_ADDRESS, XiveError::SignerNotVault);

    let position = &mut ctx.accounts.position;
    let collateral = &ctx.accounts.collateral;
    let collateral_mint = &ctx.accounts.collateral_mint;
    let xive = &mut ctx.accounts.xive;

    require!(position.close_date == 0, XiveError::PositionClosed);

    let now = Clock::get()?.unix_timestamp;
    require!(
      now.checked_sub(collateral.price_date).ok_or(XiveError::MathOverflow)? <= PRICE_TIMEOUT,
      XiveError::CollateralPriceStale
    );

    let bps = get_position_bps(
        position.loan_amount,
        position.collateral_amount,
        collateral.price,
        collateral_mint.decimals
    )?;

    require!(bps >= collateral.liquidation_ltv, XiveError::HealthyPosition);

    xive.vault_balance = xive.vault_balance
        .checked_sub(i64::try_from(position.loan_amount).map_err(|_| XiveError::MathOverflow)?)
        .ok_or(XiveError::MathOverflow)?;
    position.loan_amount = 0;
    position.close_date = now;

    position.collateral_amount = 0;
    // TODO: Transfer collateral to vault

    Ok(())
}