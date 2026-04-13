use anchor_lang::prelude::*;

use crate::{PegKeeper, PEG_KEEPER_SEED};

#[derive(Accounts)]
pub struct Hello<'info> {
    #[account(
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        bump = peg_keeper.bump,
        has_one = xive,
    )]
    pub peg_keeper: Account<'info, PegKeeper>,

    /// The xive singleton PDA — only the xive program can sign with this account.
    pub xive: Signer<'info>,
}

pub fn handler(_ctx: Context<Hello>) -> Result<()> {
    msg!("Hello from peg_keeper! Called by xive.");
    Ok(())
}
