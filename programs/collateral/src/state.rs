use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Collateral {
    pub token_mint: Pubkey,
    pub price: u64,
    pub price_updated_at: i64,
    pub bump: u8,
}

