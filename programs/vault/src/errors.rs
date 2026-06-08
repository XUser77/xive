use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Deposit amount too small")]
    DepositAmountTooSmall,

    #[msg("LP amount too small")]
    LPAmountTooSmall,

    #[msg("Slippage exceeded")]
    SlippageExceeded
}