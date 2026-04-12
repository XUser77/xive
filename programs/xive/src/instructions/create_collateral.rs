use anchor_lang::prelude::*;

use crate::{Xive, XIVE_SEED};

#[derive(Accounts)]
pub struct CreateCollateral<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        has_one = admin @ crate::error::ErrorCode::Unauthorized,
    )]
    pub xive: Account<'info, Xive>,

    /// CHECK: admin must match xive.admin via has_one
    pub admin: UncheckedAccount<'info>,

    /// CHECK: passed through to collateral program; PDA derivation is enforced there.
    pub collateral_token_mint: UncheckedAccount<'info>,

    /// CHECK: PDA account created by collateral program.
    #[account(mut)]
    pub collateral: UncheckedAccount<'info>,

    pub collateral_program: Program<'info, collateral::program::Collateral>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateCollateral>) -> Result<()> {
    let cpi_accounts = collateral::cpi::accounts::Initialize {
        payer: ctx.accounts.payer.to_account_info(),
        collateral_token_mint: ctx.accounts.collateral_token_mint.to_account_info(),
        collateral: ctx.accounts.collateral.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.collateral_program.key(), cpi_accounts);
    collateral::cpi::initialize(cpi_ctx)?;

    msg!("Xive created collateral for mint: {}", ctx.accounts.collateral_token_mint.key());
    Ok(())
}

