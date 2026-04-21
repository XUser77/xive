use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub bump: u8,
    pub lp_vault_mint: Pubkey,
}
