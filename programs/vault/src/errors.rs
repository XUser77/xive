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

    #[msg("XUSD amount too small")]
    XusdAmountTooSmall,

    #[msg("USDC amount too small")]
    UsdcAmountTooSmall,

    #[msg("Slippage exceeded")]
    SlippageExceeded
}