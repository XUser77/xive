pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("A8tMTgoWVYK8yaDmQYdpUr7sZ1hcVz3URz8aXGnncB2s");

#[program]
pub mod peg_keeper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}

