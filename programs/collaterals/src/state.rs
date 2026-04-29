use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Collateral {
    pub mint: Pubkey,
    pub bump: u8,

    pub ltv: u64,
    pub liquidation_ltv: u64,
    pub allowed: bool,

    pub price: u64,
    pub price_date: i64,
}
