use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use collaterals::{Collateral, COLLATERAL_SEED};

use crate::error::ErrorCode;
use crate::util::max_loan_xusd;
use crate::{Position, Xive};
use crate::XIVE_SEED;

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Box<Account<'info, Xive>>,

    #[account(
        mut,
        has_one = user,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), position.collateral_mint.as_ref()],
        seeds::program = collaterals::ID,
        bump = collateral.bump,
        constraint = collateral.price > 0 @ ErrorCode::ZeroPrice,
    )]
    pub collateral: Box<Account<'info, Collateral>>,

    #[account(address = position.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = user,
    )]
    pub user_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let position = &mut ctx.accounts.position;
    let collateral = &ctx.accounts.collateral;

    let new_collateral = position.collateral_amount
        .checked_sub(amount)
        .ok_or(ErrorCode::InvalidAmount)?;

    let max_loan = max_loan_xusd(
        new_collateral,
        collateral.price,
        collateral.ltv,
        ctx.accounts.collateral_mint.decimals,
    );
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
