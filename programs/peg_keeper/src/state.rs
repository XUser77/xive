use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PegKeeper {
    pub admin: Pubkey,
    pub xusd_mint: Pubkey,
    pub authorized_minter: Pubkey,
    pub bump: u8,
    pub mint_bump: u8,
    pub decimals: u8,
}

