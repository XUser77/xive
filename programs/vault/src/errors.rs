use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Deposit amount too small")]
    DepositAmountTooSmall,

    #[msg("LP amount too small")]
    LPAmountTooSmall,

    #[msg("Withdraw amount too small")]
    WithdrawAmountTooSmall,

    #[msg("xUSD amount too small")]
    XusdAmountTooSmall,

    #[msg("Slippage exceeded")]
    SlippageExceeded
}