use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

use crate::{Collateral, COLLATERAL_SEED};

#[derive(Accounts)]
pub struct AllowCollateral<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Xive>,

    #[account(
        seeds = [crate::ID.as_ref()],
        seeds::program = bpf_loader_upgradeable::ID,
        bump,
        constraint = program_data.upgrade_authority_address == Some(payer.key()),
    )]
    pub program_data: Account<'info, ProgramData>,

    /// CHECK: only used as address for collateral PDA derivation
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Collateral::INIT_SPACE,
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump,
    )]
    pub collateral: Account<'info, Collateral>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AllowCollateral>, ltv: u64, price: u64) -> Result<()> {
    let collateral = &mut ctx.accounts.collateral;

    collateral.mint = ctx.accounts.collateral_mint.key();
    collateral.bump = ctx.bumps.collateral;
    collateral.allowed = true;
    collateral.ltv = ltv;
    collateral.price = price;
    collateral.price_date = Clock::get()?.unix_timestamp;

    msg!("Collateral allowed: {}", collateral.mint);
    Ok(())
}
