use anchor_lang::prelude::*;
use crate::errors::XiveError;

pub fn get_fee(loan: u64, fee_bps: u16) -> Result<u64> {
    let fee = (loan as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(XiveError::MathOverflow)?
        / 10_000;
    Ok(fee as u64)
}