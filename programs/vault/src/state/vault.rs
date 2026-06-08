use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {

    pub bump: u8,
    pub xusd_assets: u64,
    pub usdc_assets: u64,

}