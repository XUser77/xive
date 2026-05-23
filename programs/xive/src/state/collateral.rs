use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Collateral {
    pub bump: u8,

    pub mint: Pubkey,

    pub enabled: bool,
    pub ltv: u16,
    pub liquidation_ltv: u16,

    pub price: u64,
    pub price_date: i64,
}