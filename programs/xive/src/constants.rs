use anchor_lang::prelude::*;

#[constant]
pub const XIVE_SEED: &str = "xive";

#[constant]
pub const LOAN_SEED: &str = "loan";

#[constant]
pub const PEG_KEEPER_PROGRAM_ID: Pubkey = pubkey!("xpeguefXy5MrgkbirCyuCCD5EfbUM5UfejdQduDcGz6");

#[constant]
pub const PEG_KEEPER_SEED: &str = "peg-keeper";

#[constant]
pub const VAULT_PROGRAM_ID: Pubkey = pubkey!("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");

#[constant]
pub const VAULT_SEED: &str = "vault";

#[constant]
pub const COLLATERAL_SEED: &str = "collateral";

#[constant]
pub const USER_COUNTER_SEED: &str = "user-counter";

pub const POSITION_SEED: &str = "position";

#[constant]
pub const TEAM_PROGRAM_ID: Pubkey = pubkey!("GY9r4oMpnsQyw8xgi6ZNv68vuCB1gNA1cRCZjTn5aH7g");

#[constant]
pub const TEAM_SEED: &str = "team";

#[constant]
pub const WHIRLPOOL_PROGRAM_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

#[constant]
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/// Default commission on borrows, basis points (50 = 0.5%).
pub const DEFAULT_COMMISSION_BPS: u64 = 50;

/// Share of accumulated fees sent to the team treasury (basis points, 8000 = 80%).
pub const TEAM_FEE_SHARE_BPS: u64 = 8_000;


