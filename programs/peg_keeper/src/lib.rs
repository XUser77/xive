pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("xpeguefXy5MrgkbirCyuCCD5EfbUM5UfejdQduDcGz6");

#[program]
pub mod peg_keeper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn mint_xusd(ctx: Context<MintXusd>, amount: u64) -> Result<()> {
        mint_xusd::handler(ctx, amount)
    }
}

