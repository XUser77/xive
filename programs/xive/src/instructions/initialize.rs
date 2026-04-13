use anchor_lang::prelude::*;

use crate::{Xive, XIVE_SEED, PEG_KEEPER_PROGRAM_ID, PEG_KEEPER_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Xive::INIT_SPACE,
        seeds = [XIVE_SEED.as_bytes()],
        bump,
    )]
    pub xive: Account<'info, Xive>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let xive_key = ctx.accounts.xive.key();

    let peg_keeper_program_id = PEG_KEEPER_PROGRAM_ID.parse::<Pubkey>().unwrap();
    let (peg_keeper_pda, _) = Pubkey::find_program_address(
        &[PEG_KEEPER_SEED.as_bytes()],
        &peg_keeper_program_id,
    );

    let xive = &mut ctx.accounts.xive;
    xive.admin = ctx.accounts.payer.key();
    xive.peg_keeper = peg_keeper_pda;
    xive.bump = ctx.bumps.xive;

    msg!("Xive singleton initialized");
    msg!("Xive account: {}", xive_key);
    msg!("Peg Keeper: {}", peg_keeper_pda);
    Ok(())
}

