use anchor_lang::prelude::*;

use crate::{Wallet, WALLET_SEED};

#[derive(Accounts)]
pub struct InitWallet<'info> {

    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        init,
        payer = borrower,
        space = 8 + Wallet::INIT_SPACE,
        seeds = [WALLET_SEED.as_bytes(), borrower.key().as_ref()],
        bump
    )]
    pub wallet: Account<'info, Wallet>,

    pub system_program: Program<'info, System>,

}

pub fn init_wallet(ctx: Context<InitWallet>) -> Result<()> {
    ctx.accounts.wallet.bump = ctx.bumps.wallet;
    ctx.accounts.wallet.borrower = ctx.accounts.borrower.key();
    ctx.accounts.wallet.index = 0;
    Ok(())
}