use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::{PegKeeper, PEG_KEEPER_SEED, XUSD_DECIMALS, XUSD_MINT_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + PegKeeper::INIT_SPACE,
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        bump,
    )]
    pub peg_keeper: Account<'info, PegKeeper>,

    #[account(
        init,
        payer = payer,
        seeds = [XUSD_MINT_SEED.as_bytes()],
        bump,
        mint::decimals = XUSD_DECIMALS,
        mint::authority = peg_keeper,
        mint::freeze_authority = peg_keeper,
    )]
    pub xusd_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let peg_keeper_key = ctx.accounts.peg_keeper.key();
    let xusd_mint_key = ctx.accounts.xusd_mint.key();

    let peg_keeper = &mut ctx.accounts.peg_keeper;
    peg_keeper.admin = ctx.accounts.payer.key();
    peg_keeper.xusd_mint = xusd_mint_key;
    peg_keeper.bump = ctx.bumps.peg_keeper;
    peg_keeper.mint_bump = ctx.bumps.xusd_mint;
    peg_keeper.decimals = XUSD_DECIMALS;

    msg!("Peg Keeper singleton initialized");
    msg!("Peg Keeper account: {}", peg_keeper_key);
    msg!("XUSD mint: {}", xusd_mint_key);
    Ok(())
}

