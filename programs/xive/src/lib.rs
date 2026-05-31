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

    pub fn update_collateral(ctx: Context<UpdateCollateral>, enabled: bool, ltv: u16, liquidation_ltv: u16) -> Result<()> {
        instructions::update_collateral(ctx, enabled, ltv, liquidation_ltv)
    }

    pub fn set_collateral_price(ctx: Context<SetCollateralPrice>, price: u64) -> Result<()> {
        instructions::set_collateral_price(ctx, price)
    }

    pub fn init_wallet(ctx: Context<InitWallet>) -> Result<()> {
        instructions::init_wallet(ctx)
    }

    pub fn open_position(ctx: Context<OpenPosition>, collateral_amount: u64, loan_amount: u64) -> Result<()> {
        instructions::open_position(ctx, collateral_amount, loan_amount)
    }

    pub fn deposit(ctx: Context<Deposit>, collateral_amount: u64) -> Result<()> {
        instructions::deposit(ctx, collateral_amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, collateral_amount: u64) -> Result<()> {
        instructions::withdraw(ctx, collateral_amount)
    }

    pub fn borrow(ctx: Context<Borrow>, loan_amount: u64) -> Result<()> {
        instructions::borrow(ctx, loan_amount)
    }

    pub fn repay(ctx: Context<Repay>, loan_amount: u64) -> Result<()> {
        instructions::repay(ctx, loan_amount)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position(ctx)
    }

    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        instructions::liquidate_position(ctx)
    }

    pub fn return_collateral(ctx: Context<ReturnCollateral>, collateral_amount: u64) -> Result<()> {
        instructions::return_collateral(ctx, collateral_amount)
    }

    pub fn mint(ctx: Context<Mint>, amount: u64) -> Result<()> {
        instructions::mint(ctx, amount)
    }

    pub fn burn(ctx: Context<Burn>, amount: u64) -> Result<()> {
        instructions::burn(ctx, amount)
    }
}
