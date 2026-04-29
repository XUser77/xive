use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Fees {
    pub bump: u8,
    /// Orca whirlpool position NFT mint owned by fees PDA — destination for the LP slice
    /// of `withdraw_fees`. Pubkey::default() means no LP position has been initialized yet.
    pub lp_position_mint: Pubkey,
    /// The whirlpool the lp_position belongs to (XUSD/USDC stable pool).
    pub lp_whirlpool: Pubkey,
}
