use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::{Collateral, Position, Xive};
use crate::{COLLATERAL_SEED, PEG_KEEPER_PROGRAM_ID, PEG_KEEPER_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct Borrow<'info> {
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

    /// CHECK: peg_keeper PDA — address derived from well-known program ID and seed
    #[account(
        mut,
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        seeds::program = peg_keeper_program,
        bump,
    )]
    pub peg_keeper: UncheckedAccount<'info>,

    #[account(mut, address = peg_keeper::XUSD_MINT)]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = user,
    )]
    pub user_xusd_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub peg_keeper_program: Program<'info, peg_keeper::program::PegKeeper>,
}

pub fn handler(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let position = &mut ctx.accounts.position;
    let collateral = &ctx.accounts.collateral;

    let new_loan = position.loan_amount.checked_add(amount).unwrap();

    let max_loan = (position.collateral_amount as u128)
        .checked_mul(collateral.price as u128).unwrap()
        .checked_mul(collateral.ltv as u128).unwrap()
        .checked_div(100).unwrap();
    require!(new_loan as u128 <= max_loan, ErrorCode::InsufficientCollateral);

    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    peg_keeper::cpi::mint_xusd(
        CpiContext::new_with_signer(
            PEG_KEEPER_PROGRAM_ID,
            peg_keeper::cpi::accounts::MintXusd {
                peg_keeper: ctx.accounts.peg_keeper.to_account_info(),
                authorized_minter: ctx.accounts.xive.to_account_info(),
                xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                recipient_token_account: ctx.accounts.user_xusd_ata.to_account_info(),
                xive: ctx.accounts.xive.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    position.loan_amount = new_loan;

    msg!("Borrowed {}, new loan {}", amount, position.loan_amount);
    Ok(())
}
