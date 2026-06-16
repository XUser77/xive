use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Team {

    pub bump: u8,

    // Cumulative xUSD distributed per staked veXIVE, scaled by ACC_SCALE.
    pub acc_xusd_per_share: u128,

    // Total veXIVE currently staked across all users.
    pub total_staked: u64,

    // Fees that arrived while total_staked == 0, carried into the next distribution.
    pub undistributed: u64,

}
