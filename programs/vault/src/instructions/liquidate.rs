use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{Vault, VAULT_SEED, XUSD_MINT};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: xive global PDA — validated by xive CPI.
    #[account(mut)]
    pub xive_state: UncheckedAccount<'info>,

    /// CHECK: xive collateral PDA — validated by xive CPI.
    #[account(mut)]
    pub xive_collateral: UncheckedAccount<'info>,

    /// CHECK: position account — validated by xive CPI (has_one = user).
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    #[account(mut, address = XUSD_MINT)]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer=payer,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Account<'info, TokenAccount>,

    /// CHECK: validated by xive CPI via position.collateral_mint.
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    /// CHECK: xive's collateral vault ATA — validated by xive CPI.
    #[account(mut)]
    pub xive_collateral_ata: UncheckedAccount<'info>,

    pub xive_program: Program<'info, xive::program::Xive>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    let bump = ctx.accounts.vault.bump;
    let seeds: &[&[u8]] = &[VAULT_SEED.as_bytes(), std::slice::from_ref(&bump)];
    let signer_seeds = &[seeds];

    xive::cpi::liquidate(CpiContext::new_with_signer(
        ctx.accounts.xive_program.to_account_info().key(),
        xive::cpi::accounts::Liquidate {
            caller: ctx.accounts.vault.to_account_info(),
            xive: ctx.accounts.xive_state.to_account_info(),
            collateral: ctx.accounts.xive_collateral.to_account_info(),
            position: ctx.accounts.position.to_account_info(),
            xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
            caller_xusd_ata: ctx.accounts.vault_xusd_ata.to_account_info(),
            collateral_mint: ctx.accounts.collateral_mint.to_account_info(),
            caller_collateral_ata: ctx.accounts.vault_collateral_ata.to_account_info(),
            vault_collateral_ata: ctx.accounts.xive_collateral_ata.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        signer_seeds,
    ))?;

    msg!("Vault liquidated position via xive CPI");
    Ok(())
}
