use anchor_lang::prelude::*;
use crate::constants::ACC_SCALE;
use crate::errors::TeamError;

#[account]
#[derive(InitSpace)]
pub struct Stake {

    pub bump: u8,
    pub owner: Pubkey,

    // Staked veXIVE (equals the XIVE this user has locked).
    pub amount: u64,

    // amount * acc_xusd_per_share / ACC_SCALE captured at the last settle.
    pub reward_debt: u128,

    // Settled-but-unclaimed xUSD.
    pub pending: u64,

}

impl Stake {

    // Reward this stake is entitled to at the given accumulator.
    fn accumulated(&self, acc_xusd_per_share: u128) -> Result<u128> {
        let total = (self.amount as u128)
            .checked_mul(acc_xusd_per_share)
            .ok_or(TeamError::MathOverflow)?;
        Ok(total / ACC_SCALE)
    }

    // Move newly-accrued reward into `pending` and sync the debt to the current
    // accumulator. Call this BEFORE changing `amount`.
    pub fn harvest(&mut self, acc_xusd_per_share: u128) -> Result<()> {
        let accumulated = self.accumulated(acc_xusd_per_share)?;
        let delta = accumulated
            .checked_sub(self.reward_debt)
            .ok_or(TeamError::MathOverflow)?;
        let delta = u64::try_from(delta).map_err(|_| TeamError::MathOverflow)?;
        self.pending = self.pending.checked_add(delta).ok_or(TeamError::MathOverflow)?;
        self.reward_debt = accumulated;
        Ok(())
    }

    // Re-sync the debt to the current `amount`. Call this AFTER changing `amount`
    // (the accumulator hasn't moved, so no reward accrues here).
    pub fn sync_debt(&mut self, acc_xusd_per_share: u128) -> Result<()> {
        self.reward_debt = self.accumulated(acc_xusd_per_share)?;
        Ok(())
    }

}
