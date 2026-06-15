use anchor_lang::prelude::*;

#[error_code]
pub enum TeamError {
    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Value cannot be zero")]
    ValueCannotBeZero,
}
