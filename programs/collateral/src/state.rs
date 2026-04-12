use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Collateral {
    pub token_mint: Pubkey,
    pub bump: u8,
}

