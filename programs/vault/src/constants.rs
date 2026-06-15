use anchor_lang::prelude::*;

#[constant]
pub const VAULT_SEED: &str = "vault";

#[constant]
pub const SWAP_FEE: u8 = 5; // 5 / 10000 = 0.0005 ~ 0.05%

#[constant]
pub const LP_XUSD_MINT_ADDRESS: Pubkey = pubkey!("xLPy37ThnjtANeeiqR9N2YmjK4q7T8zFNfQteFZ5PCm");

#[constant]
pub const LP_XUSD_DECIMALS: u8 = 6;

#[constant]
pub const LP_XUSD_MIN_PRICE: u64 = 100 * 1000; // 100_000 => 0.1 XUSD

#[constant]
pub const LP_XUSD_INITIAL_PRICE: u64 = 1000 * 1000; // 1_000_000 => 1 XUSD

#[constant]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

#[constant]
pub const XIVE_PROGRAM_ID: Pubkey = pubkey!("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");