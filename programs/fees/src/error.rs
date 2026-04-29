use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
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
