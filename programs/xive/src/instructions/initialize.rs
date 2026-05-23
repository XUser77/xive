use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::{Xive, VAULT_DEPT_SEED};
use crate::{XUSD_MINT_ADDRESS, XUSD_DECIMALS};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Xive::INIT_SPACE,
        seeds = [VAULT_DEPT_SEED.as_bytes()],
        bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        init,
        payer = payer,
        address = XUSD_MINT_ADDRESS,
        mint::decimals = XUSD_DECIMALS,
        mint::authority = xive,
        mint::freeze_authority = xive,
    )]
    pub xusd_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.xive.bump = ctx.bumps.xive;
    Ok(())
}
