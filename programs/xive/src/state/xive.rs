use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Xive {
    pub bump: u8,
    pub vault_dept: u64,
    pub loan_fee: u16,
}