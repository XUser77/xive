use anchor_lang::prelude::*;
use crate::{Position, UserCounter};

use crate::{USER_COUNTER_SEED, POSITION_SEED};

#[derive(Accounts)]
pub struct Lend<'info> {

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserCounter::INIT_SPACE,
        seeds = [USER_COUNTER_SEED.as_bytes(), user.key().as_ref()],
        bump,
    )]
    pub user_counter: Account<'info, UserCounter>,

    #[account(
        init,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED.as_bytes(), user.key().as_ref(), &user_counter.counter.to_le_bytes()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Lend>, collateral_amount: u64, loan_amount: u64) -> Result<()> {
    
    Ok(())
}