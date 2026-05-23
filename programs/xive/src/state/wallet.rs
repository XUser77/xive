use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Wallet {
    pub bump: u8,
    pub authority: Pubkey,
    pub index: u64,
}