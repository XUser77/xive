use anchor_lang::prelude::*;

#[constant]
pub const XIVE_SEED: &str = "xive";

#[constant]
pub const XUSD_MINT_ADDRESS: Pubkey = pubkey!("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");

#[constant]
pub const VAULT_ADDRESS: Pubkey = pubkey!("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");

#[constant]
pub const TEAM_ADDRESS: Pubkey = pubkey!("xtm3VMkqiNhP2rd74yZUzsXFZMyAJapmcP7HUSfwD4i");

#[constant]
pub const XUSD_DECIMALS: u8 = 6;

#[constant]
pub const WALLET_SEED: &str = "wallet";

#[constant]
pub const POSITION_SEED: &str = "pos";

#[constant]
pub const COLLATERAL_SEED: &str = "collateral";

#[constant]
pub const PRICE_TIMEOUT: i64 = 300;
