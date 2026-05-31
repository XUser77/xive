use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Xive {
    pub bump: u8,
    pub loan_fee: u16,

    pub vault_balance: i64,
    pub team_balance: i64,
}