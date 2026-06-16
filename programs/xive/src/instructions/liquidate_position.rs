use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Mint, Token, TokenAccount, TransferChecked};
use crate::{Position, POSITION_SEED, PRICE_TIMEOUT, COLLATERAL_SEED, XIVE_SEED };
use crate::errors::XiveError;
use crate::state::collateral::Collateral;
use crate::state::xive::Xive;
use crate::utils::{get_position_bps, get_vault_pda_address};

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
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub xive_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = collateral_mint,
        associated_token::authority = signer,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,

}

pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {

    require!(ctx.accounts.signer.key() == get_vault_pda_address()?, XiveError::SignerNotVault);

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

    let collateral_amount = position.collateral_amount;

    xive.vault_balance = xive.vault_balance
        .checked_sub(i64::try_from(position.loan_amount).map_err(|_| XiveError::MathOverflow)?)
        .ok_or(XiveError::MathOverflow)?;
    position.loan_amount = 0;
    position.close_date = now;
    position.collateral_amount = 0;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                mint: ctx.accounts.collateral_mint.to_account_info(),
                from: ctx.accounts.xive_collateral_ata.to_account_info(),
                to: ctx.accounts.vault_collateral_ata.to_account_info(),
                authority: ctx.accounts.xive.to_account_info(),
            }
        ),
        collateral_amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    Ok(())
}