use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Xive {
    pub bump: u8,
    /// Commission charged on borrowed XUSD, in basis points (10_000 = 100%).
    pub commission_bps: u64,
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
