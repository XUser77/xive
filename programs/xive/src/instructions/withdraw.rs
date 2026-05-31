use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{ Position, POSITION_SEED, Xive, XIVE_SEED, COLLATERAL_SEED };
use crate::instructions::process_position::withdraw_collateral;
use crate::state::collateral::Collateral;

#[derive(Accounts)]
pub struct Withdraw<'info> {

    borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED.as_bytes(), borrower.key().as_ref(), position.index.to_le_bytes().as_ref()],
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
    pub program_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn withdraw(ctx: Context<Withdraw>, collateral_amount: u64) -> Result<()> {

    withdraw_collateral(
        &mut ctx.accounts.position,
        &ctx.accounts.xive,
        ctx.accounts.token_program.key(),
        ctx.accounts.borrower_collateral_ata.to_account_info(),
        ctx.accounts.program_collateral_ata.to_account_info(),
        &ctx.accounts.collateral_mint,
        &ctx.accounts.collateral,
        collateral_amount,
    )?;

    Ok(())
}