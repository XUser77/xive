use anchor_lang::prelude::*;

#[constant]
pub const TEAM_SEED: &str = "team";

#[constant]
pub const XIVE_PROGRAM_ID: Pubkey = pubkey!("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");

#[constant]
pub const XIVE_TOKEN_ADDRESS: Pubkey = pubkey!("xtxv4YGRjLXEZSGJcpi4wiCcJAv4AYcES7C35mHZFn3");

#[constant]
pub const VE_XIVE_TOKEN_ADDRESS: Pubkey = pubkey!("xvepigF8qv1N2WdCmsQ6oht8owBjMDRV86uYvwprqo3");

#[constant]
pub const XIVE_TOKEN_SUPPLY: u64 = 1_000_000_000 * 1_000_000; // 1 Billion

#[constant]
pub const STAKE_SEED: &str = "stake";

// Fixed-point scale for the xUSD-per-staked-veXIVE reward accumulator.
pub const ACC_SCALE: u128 = 1_000_000_000_000; // 1e12
