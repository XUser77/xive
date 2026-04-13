pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");

#[program]
pub mod xive {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn allow_collateral(ctx: Context<AllowCollateral>, ltv: u64) -> Result<()> {
        allow_collateral::handler(ctx, ltv)
    }

    pub fn disallow_collateral(ctx: Context<DisallowCollateral>) -> Result<()> {
        disallow_collateral::handler(ctx)
    }

    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> Result<()> {
        set_price::handler(ctx, price)
    }
}
