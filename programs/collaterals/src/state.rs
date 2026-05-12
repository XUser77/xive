use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Collateral {
    pub mint: Pubkey,
    pub bump: u8,

    pub ltv: u64,
    pub liquidation_ltv: u64,
    pub allowed: bool,

    /// USD per whole collateral token, scaled by 10^PRICE_DECIMALS (6).
    /// e.g. 3_000_000_000 = $3000.00; 500_000 = $0.50.
    pub price: u64,
    pub price_date: i64,
}
