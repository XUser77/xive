use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Collateral price is zero")]
    ZeroPrice,
    #[msg("Insufficient collateral value")]
    InsufficientCollateral,
    #[msg("Collateral not allowed")]
    CollateralNotAllowed,
    #[msg("Invalid amount")]
    InvalidAmount,
}

