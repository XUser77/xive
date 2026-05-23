use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub bump: u8,

    pub borrower: Pubkey,
    pub index: u64,
    pub collateral_mint: Pubkey,

    pub collateral_amount: u64,
    pub loan_amount: u64,

    pub close_date: i64,
}