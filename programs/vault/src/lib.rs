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

    pub fn deposit(ctx: Context<Deposit>, xusd_amount: u64, min_lp_amount: u64) -> Result<()> {
        instructions::deposit(ctx, xusd_amount, min_lp_amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, lp_amount: u64, min_xusd_amount: u64) -> Result<()> {
        instructions::withdraw(ctx, lp_amount, min_xusd_amount)
    }

    pub fn buy_xusd(ctx: Context<BuyXusd>, amount: u64) -> Result<()> {
        instructions::buy_xusd(ctx, amount)
    }

    pub fn buy_usdc(ctx: Context<BuyUsdc>, amount: u64) -> Result<()> {
        instructions::buy_usdc(ctx, amount)
    }

    pub fn transfer_to_xive(ctx: Context<TransferToXive>, amount: u64) -> Result<()> {
        instructions::transfer_to_xive(ctx, amount)
    }

    pub fn transfer_from_xive(ctx: Context<TransferFromXive>, amount: u64) -> Result<()> {
        instructions::transfer_from_xive(ctx, amount)
    }

    pub fn liquidate(ctx: Context<Liquidate>, jupiter_swap_data: Vec<u8>) -> Result<()> {
        instructions::liquidate(ctx, jupiter_swap_data)
    }

}
