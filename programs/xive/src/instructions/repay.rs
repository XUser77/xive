use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::Position;

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        has_one = user,
    )]
    pub position: Account<'info, Position>,

    #[account(mut, address = peg_keeper::XUSD_MINT)]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = user,
    )]
    pub user_xusd_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let position = &mut ctx.accounts.position;
    let new_loan = position.loan_amount
        .checked_sub(amount)
        .ok_or(ErrorCode::InvalidAmount)?;

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                from: ctx.accounts.user_xusd_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    position.loan_amount = new_loan;

    msg!("Repaid {}, new loan {}", amount, position.loan_amount);
    Ok(())
}
