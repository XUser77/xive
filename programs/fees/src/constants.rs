use anchor_lang::prelude::*;

#[constant]
pub const FEES_SEED: &str = "fees";

#[constant]
pub const XUSD_MINT: Pubkey = pubkey!("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");

#[constant]
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

#[constant]
pub const WHIRLPOOL_PROGRAM_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

#[constant]
pub const TEAM_PROGRAM_ID: Pubkey = pubkey!("GY9r4oMpnsQyw8xgi6ZNv68vuCB1gNA1cRCZjTn5aH7g");

#[constant]
pub const TEAM_SEED: &str = "team";

/// Share of accumulated fees sent to the team treasury (basis points, 8000 = 80%).
pub const TEAM_FEE_SHARE_BPS: u64 = 8_000;
