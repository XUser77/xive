#![allow(unexpected_cfgs)]

pub mod instructions;
pub mod state;
pub mod constants;

use state::vault::Vault;
use constants::{ VAULT_SEED, LP_XUSD_ADDRESS, LP_XUSD_DECIMALS };
use instructions::*;

use anchor_lang::prelude::*;

declare_id!("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

}
