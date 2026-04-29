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
pub const USER_COUNTER_SEED: &str = "user-counter";

pub const POSITION_SEED: &str = "position";

/// Default commission on borrows, basis points (50 = 0.5%).
pub const DEFAULT_COMMISSION_BPS: u64 = 50;


