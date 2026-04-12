pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("3qiZw1HDmqhT2gQj5MQyfFetxe9Hx8CUPJiTsCs9LFkm");

#[program]
pub mod collateral {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> Result<()> {
        set_price::handler(ctx, price)
    }
}

