use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Position has no debt to liquidate")]
    NoDebt,
    #[msg("Position has no collateral to seize")]
    NoCollateral,
    #[msg("Swap consumed more collateral than was seized")]
    SwapOverConsumed,
}
