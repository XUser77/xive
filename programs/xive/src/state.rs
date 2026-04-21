use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Xive {
    pub bump: u8,
}

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

#[account]
#[derive(InitSpace)]
pub struct UserCounter {
    pub bump: u8,
    pub counter: u64
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub bump: u8,
    pub user: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub loan_amount: u64,
}
