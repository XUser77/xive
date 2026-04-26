pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod util;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;
pub use util::*;

declare_id!("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");

#[program]
pub mod xive {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn allow_collateral(ctx: Context<AllowCollateral>, ltv: u64, liquidation_ltv: u64, price: u64) -> Result<()> {
        allow_collateral::handler(ctx, ltv, liquidation_ltv, price)
    }

    pub fn disallow_collateral(ctx: Context<DisallowCollateral>) -> Result<()> {
        disallow_collateral::handler(ctx)
    }

    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> Result<()> {
        set_price::handler(ctx, price)
    }

    pub fn open_position(ctx: Context<OpenPosition>, collateral_amount: u64, loan_amount: u64) -> Result<()> {
        open_position::handler(ctx, collateral_amount, loan_amount)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        deposit_collateral::handler(ctx, amount)
    }

    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        withdraw_collateral::handler(ctx, amount)
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        borrow::handler(ctx, amount)
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        repay::handler(ctx, amount)
    }

    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        liquidate::handler(ctx)
    }

    pub fn create_user_state(ctx: Context<CreateUserState>) -> Result<()> {
        create_user_state::handler()
    }

    pub fn return_collateral(ctx: Context<ReturnCollateral>, amount: u64) -> Result<()> {
        return_collateral::handler(ctx, amount)
    }
}
