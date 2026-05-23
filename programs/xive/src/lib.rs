#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod constants;

use constants::*;
use state::xive::Xive;
use state::wallet::Wallet;
use instructions::*;

declare_id!("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");

#[program]
pub mod xive {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    pub fn init_wallet(ctx: Context<InitWallet>) -> Result<()> {
        instructions::init_wallet(ctx)
    }
}
