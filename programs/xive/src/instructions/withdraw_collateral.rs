use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::{Collateral, Position, Xive};
use crate::{COLLATERAL_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        has_one = user,
    )]
    pub position: Account<'info, Position>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), position.collateral_mint.as_ref()],
        bump = collateral.bump,
        constraint = collateral.price > 0 @ ErrorCode::ZeroPrice,
    )]
    pub collateral: Account<'info, Collateral>,

    /// CHECK: only used as address for ATA derivation; validated via position.collateral_mint
    #[account(address = position.collateral_mint)]
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = user,
    )]
    pub user_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let position = &mut ctx.accounts.position;
    let collateral = &ctx.accounts.collateral;

    let new_collateral = position.collateral_amount
        .checked_sub(amount)
        .ok_or(ErrorCode::InvalidAmount)?;

    let max_loan = (new_collateral as u128)
        .checked_mul(collateral.price as u128).unwrap()
        .checked_mul(collateral.ltv as u128).unwrap()
        .checked_div(100).unwrap();
    require!(position.loan_amount as u128 <= max_loan, ErrorCode::InsufficientCollateral);

    position.collateral_amount = new_collateral;

    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_collateral_ata.to_account_info(),
                to: ctx.accounts.user_collateral_ata.to_account_info(),
                authority: ctx.accounts.xive.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    msg!("Collateral withdrawn: {}, new amount {}", amount, position.collateral_amount);
    Ok(())
}
