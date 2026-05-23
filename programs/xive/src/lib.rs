#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod constants;
pub mod errors;
pub mod utils;

use constants::*;
use state::xive::Xive;
use state::wallet::Wallet;
use state::position::Position;
use instructions::*;

declare_id!("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");

#[program]
pub mod xive {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, loan_fee: u16) -> Result<()> {
        instructions::initialize(ctx, loan_fee)
    }

    pub fn update_collateral(ctx: Context<UpdateCollateral>, enabled: bool, tvl: u16, liquidation_tvl: u16) -> Result<()> {
        instructions::update_collateral(ctx, enabled, tvl, liquidation_tvl)
    }

    pub fn set_collateral_price(ctx: Context<SetCollateralPrice>, price: u64) -> Result<()> {
        instructions::set_collateral_price(ctx, price)
    }

    pub fn init_wallet(ctx: Context<InitWallet>) -> Result<()> {
        instructions::init_wallet(ctx)
    }
}
