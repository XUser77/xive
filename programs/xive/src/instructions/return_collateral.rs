use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::{Position, Xive};
use crate::{VAULT_PROGRAM_ID, VAULT_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct ReturnCollateral<'info> {
    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        seeds::program = VAULT_PROGRAM_ID,
        bump,
    )]
    pub caller: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Box<Account<'info, Xive>>,

    #[account(mut)]
    pub position: Box<Account<'info, Position>>,

    #[account(address = position.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = caller,
    )]
    pub caller_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReturnCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info().key(),
            Transfer {
                from: ctx.accounts.caller_collateral_ata.to_account_info(),
                to: ctx.accounts.vault_collateral_ata.to_account_info(),
                authority: ctx.accounts.caller.to_account_info(),
            },
        ),
        amount,
    )?;

    let position = &mut ctx.accounts.position;
    position.collateral_amount = position
        .collateral_amount
        .checked_add(amount)
        .ok_or(ErrorCode::InvalidAmount)?;

    msg!(
        "Returned {} collateral to position, new amount {}",
        amount,
        position.collateral_amount
    );
    Ok(())
}
