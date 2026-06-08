use anchor_lang::prelude::*;

#[constant]
pub const VAULT_SEED: &str = "vault";

#[constant]
pub const SWAP_FEE: u8 = 5; // 5 / 10000 = 0.0005 ~ 0.05%

#[constant]
pub const LP_XUSD_ADDRESS: Pubkey = pubkey!("xLPy37ThnjtANeeiqR9N2YmjK4q7T8zFNfQteFZ5PCm");

#[constant]
pub const LP_XUSD_DECIMALS: u8 = 6;