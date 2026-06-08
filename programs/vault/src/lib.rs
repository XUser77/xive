#![allow(unexpected_cfgs)]

pub mod instructions;
pub mod state;
pub mod constants;
pub mod errors;

use state::vault::Vault;
use constants::*;
use instructions::*;
use errors::*;
use xive::constants::*;
use xive::state::xive::*;

use anchor_lang::prelude::*;

declare_id!("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

}
