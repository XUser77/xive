pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, orca_pool: Pubkey) -> Result<()> {
        initialize::handler(ctx, orca_pool)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, lp_amount: u64) -> Result<()> {
        withdraw::handler(ctx, lp_amount)
    }

    pub fn liquidate(ctx: Context<Liquidate>, a_to_b_one: bool, a_to_b_two: bool) -> Result<()> {
        liquidate::handler(ctx, a_to_b_one, a_to_b_two)
    }

    pub fn flash_loan_liquidate(ctx: Context<FlashLoanLiquidate>) -> Result<()> {
        flash_loan_liquidate::handler(ctx)
    }
}
