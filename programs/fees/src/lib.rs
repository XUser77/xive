pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("xfeewAjbVVJkjXUaxQxSmWgLNrixEFMJN3oNhNxQvCY");

#[program]
pub mod fees {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn init_lp_position(ctx: Context<InitLpPosition>) -> Result<()> {
        init_lp_position::handler(ctx)
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        withdraw_fees::handler(ctx)
    }
}
