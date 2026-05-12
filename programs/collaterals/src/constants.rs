use anchor_lang::prelude::*;

#[constant]
pub const COLLATERAL_SEED: &str = "collateral";

/// Number of decimals in `Collateral::price`. A raw value of 3_000_000_000
/// means $3000.00, a raw value of 500_000 means $0.50, etc.
#[constant]
pub const PRICE_DECIMALS: u8 = 6;
