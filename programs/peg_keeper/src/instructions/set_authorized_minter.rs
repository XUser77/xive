use anchor_lang::prelude::*;

use crate::{PegKeeper, PEG_KEEPER_SEED};

#[derive(Accounts)]
pub struct SetAuthorizedMinter<'info> {
    #[account(
        mut,
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        bump = peg_keeper.bump,
        has_one = admin,
    )]
    pub peg_keeper: Account<'info, PegKeeper>,

    pub admin: Signer<'info>,
}

pub fn handler(ctx: Context<SetAuthorizedMinter>, minter: Pubkey) -> Result<()> {
    ctx.accounts.peg_keeper.authorized_minter = minter;
    msg!("Authorized minter set to: {}", minter);
    Ok(())
}
