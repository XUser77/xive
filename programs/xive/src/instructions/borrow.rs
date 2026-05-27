use crate::errors::XiveError;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::instructions::process_position::borrow_xusd;
use crate::{ Position, POSITION_SEED, Xive, XIVE_SEED, XUSD_MINT_ADDRESS, COLLATERAL_SEED };
use crate::state::collateral::Collateral;

#[derive(Accounts)]
pub struct Borrow<'info> {

    #[account()]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED.as_bytes(), borrower.key().as_ref(), position.index.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
        mint::authority = xive,
    )]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump = collateral.bump,
        constraint = collateral.enabled @ XiveError::CollateralDisabled,
    )]
    pub collateral: Account<'info, Collateral>,

    #[account(
        address = position.collateral_mint
    )]
    pub collateral_mint: Account<'info, Mint>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    pub token_program: Program<'info, Token>,

}

pub fn borrow(ctx: Context<Borrow>, loan_amount: u64) -> Result<()> {

    borrow_xusd(
        &mut ctx.accounts.position,
        &ctx.accounts.xive,
        ctx.accounts.token_program.key(),
        ctx.accounts.xusd_mint.to_account_info(),
        ctx.accounts.borrower_xusd_ata.to_account_info(),
        loan_amount,
        &ctx.accounts.collateral,
        &ctx.accounts.collateral_mint,
    )?;

    Ok(())

}
