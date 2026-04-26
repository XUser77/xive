use anchor_lang::prelude::*;

#[constant]
pub const VAULT_SEED: &str = "vault";

#[constant]
pub const LP_VAULT_MINT: Pubkey = pubkey!("xLPy37ThnjtANeeiqR9N2YmjK4q7T8zFNfQteFZ5PCm");

#[constant]
pub const LP_VAULT_DECIMALS: u8 = 6;

#[constant]
pub const XUSD_MINT: Pubkey = pubkey!("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");

#[constant]
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

#[constant]
pub const WHIRLPOOL_PROGRAM_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

#[constant]
pub const LIQUIDATION_BONUS_BPS: u64 = 500;
