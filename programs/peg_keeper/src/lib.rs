pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("BShpFcv65t5sJMFWEZEufsCcU7imeQSakZw1xZjLNJGu");

#[program]
pub mod peg_keeper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn set_authorized_minter(ctx: Context<SetAuthorizedMinter>, minter: Pubkey) -> Result<()> {
        set_authorized_minter::handler(ctx, minter)
    }

    pub fn mint_xusd(ctx: Context<MintXusd>, amount: u64) -> Result<()> {
        mint_xusd::handler(ctx, amount)
    }
}

