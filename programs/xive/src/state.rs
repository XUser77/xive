use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Xive {
    pub admin: Pubkey,
    pub peg_keeper: Pubkey,
    pub bump: u8,
}
