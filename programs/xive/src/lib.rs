pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("Aiz3dMSA1y45gdU4Z1xYxirRYW5HErYx4LgY8voHNkLJ");

#[program]
pub mod xive {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn create_collateral(ctx: Context<CreateCollateral>) -> Result<()> {
        create_collateral::handler(ctx)
    }

    pub fn take_loan(ctx: Context<TakeLoan>, collateral_amount: u64) -> Result<()> {
        take_loan::handler(ctx, collateral_amount)
    }
}

