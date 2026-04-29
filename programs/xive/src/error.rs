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
    #[msg("Position is healthy and cannot be liquidated")]
    PositionHealthy,
    #[msg("LP position has already been initialized")]
    LpPositionAlreadyInitialized,
    #[msg("LP position is not initialized")]
    LpPositionNotInitialized,
    #[msg("Position mint mismatch")]
    PositionMintMismatch,
    #[msg("Whirlpool mismatch")]
    WhirlpoolMismatch,
    #[msg("No fees to withdraw")]
    NoFees,
}

