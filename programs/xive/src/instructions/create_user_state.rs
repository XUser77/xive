use anchor_lang::prelude::*;
use crate::{UserCounter, USER_COUNTER_SEED};

#[derive(Accounts)]
pub struct CreateUserState<'info> {

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + UserCounter::INIT_SPACE,
        seeds = [USER_COUNTER_SEED.as_bytes(), user.key().as_ref()],
        bump,
    )]
    pub user_counter: Account<'info, UserCounter>,

    pub system_program: Program<'info, System>,

}

pub fn handler() -> Result<()> {
    Ok(())
}