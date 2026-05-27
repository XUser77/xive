use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{Position, POSITION_SEED, XIVE_SEED, Xive };
use crate::errors::XiveError;
use crate::instructions::process_position::deposit_collateral;

#[derive(Accounts)]
pub struct Deposit<'info> {

    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED.as_bytes(), borrower.key().as_ref(), position.index.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        address = position.collateral_mint
    )]
    pub collateral_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub program_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn deposit(ctx: Context<Deposit>, collateral_amount: u64) -> Result<()> {
    require!(ctx.accounts.position.close_date == 0, XiveError::PositionClosed);

    deposit_collateral(
        &mut ctx.accounts.position,
        ctx.accounts.token_program.key(),
        ctx.accounts.borrower_collateral_ata.to_account_info(),
        ctx.accounts.program_collateral_ata.to_account_info(),
        &ctx.accounts.collateral_mint,
        ctx.accounts.borrower.to_account_info(),
        collateral_amount,
    )?;

    Ok(())
}