use anchor_lang::prelude::*;

#[constant]
pub const TEAM_SEED: &str = "team";

#[constant]
pub const XIVE_PROGRAM_ID: Pubkey = pubkey!("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");

#[constant]
pub const XIVE_TOKEN_ADDRESS: Pubkey = pubkey!("xtxv4YGRjLXEZSGJcpi4wiCcJAv4AYcES7C35mHZFn3");

#[constant]
pub const VE_XIVE_TOKEN_ADDRESS: Pubkey = pubkey!("xvepigF8qv1N2WdCmsQ6oht8owBjMDRV86uYvwprqo3");

// Not #[constant]: anchor's idl-build types integer literals as i32, and this value
// exceeds i32::MAX. It's an internal constant and isn't needed in the IDL.
pub const XIVE_TOKEN_SUPPLY: u64 = 1_000_000_000_000_000; // 1 billion tokens * 1e6 decimals

#[constant]
pub const STAKE_SEED: &str = "stake";

// Fixed-point scale for the xUSD-per-staked-veXIVE reward accumulator.
pub const ACC_SCALE: u128 = 1_000_000_000_000; // 1e12
