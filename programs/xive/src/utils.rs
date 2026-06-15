use anchor_lang::prelude::*;
use crate::constants::{TEAM_ADDRESS, TEAM_SEED, VAULT_ADDRESS, VAULT_SEED};
use crate::errors::XiveError;

pub fn get_fee(loan: u64, fee_bps: u16) -> Result<u64> {
    let fee = (loan as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(XiveError::MathOverflow)?
        / 10_000;
    Ok(fee as u64)
}

pub fn get_position_bps(xusd: u64, collateral: u64, collateral_price: u64, collateral_decimals: u8) -> Result<u16> {
    if xusd == 0 {
        return Ok(0);
    }

    let collateral_value = (collateral as u128)
        .checked_mul(collateral_price as u128)
        .ok_or(XiveError::MathOverflow)?
        / 10u128.pow(collateral_decimals as u32);

    require!(collateral_value > 0, XiveError::CollateralZero);

    let bps = (xusd as u128)
        .checked_mul(10_000)
        .ok_or(XiveError::MathOverflow)?
        / collateral_value;

    Ok(u16::try_from(bps).unwrap_or(u16::MAX))
}

pub fn get_vault_pda_address() -> Result<Pubkey> {
    let (vault_pda, _) = Pubkey::find_program_address(&[VAULT_SEED.as_bytes()], &VAULT_ADDRESS);
    Ok(vault_pda)
}

pub fn get_team_pda_address() -> Result<Pubkey> {
    let (vault_pda, _) = Pubkey::find_program_address(&[TEAM_SEED.as_bytes()], &TEAM_ADDRESS);
    Ok(vault_pda)
}