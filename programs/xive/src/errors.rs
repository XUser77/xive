use anchor_lang::prelude::*;

#[error_code]
pub enum XiveError {
    #[msg("Loan fee must be < 10000")]
    TooBigLoanFee,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Collateral amount is zero")]
    CollateralZero,

    #[msg("Loan amount is zero")]
    LoanZero,

    #[msg("Collateral disabled")]
    CollateralDisabled,

    #[msg("LTV breached")]
    LTVBreached,

    #[msg("Collateral price is stale")]
    CollateralPriceStale,

    #[msg("Invalid LTV")]
    InvalidLtv,
}