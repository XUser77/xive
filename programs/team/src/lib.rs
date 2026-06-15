#![allow(unexpected_cfgs)]

pub mod instructions;
pub mod state;
pub mod constants;
pub mod errors;

use state::team::Team;
use constants::*;
use instructions::*;
use errors::*;
use xive::constants::*;
use xive::state::xive::*;

use anchor_lang::prelude::*;

declare_id!("xtm3VMkqiNhP2rd74yZUzsXFZMyAJapmcP7HUSfwD4i");

#[program]
pub mod team {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    pub fn transfer_from_xive(ctx: Context<TransferFromXive>, amount: u64) -> Result<()> {
        instructions::transfer_from_xive(ctx, amount)
    }

}
