use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::{Vault, LP_VAULT_MINT, VAULT_SEED, XUSD_MINT};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
        has_one = lp_vault_mint,
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = XUSD_MINT)]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = user,
    )]
    pub user_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Account<'info, TokenAccount>,

    #[account(mut, address = LP_VAULT_MINT)]
    pub lp_vault_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = lp_vault_mint,
        associated_token::authority = user,
    )]
    pub user_lp_vault_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, lp_amount: u64) -> Result<()> {
    require!(lp_amount > 0, ErrorCode::InvalidAmount);

    let total_xusd = ctx.accounts.vault_xusd_ata.amount as u128;
    let total_lp_supply = ctx.accounts.lp_vault_mint.supply as u128;

    require!(total_xusd > 0, ErrorCode::InvalidAmount);
    require!(total_lp_supply > 0, ErrorCode::InvalidAmount);

    let xusd_amount = ((lp_amount as u128)
        .checked_mul(total_xusd)
        .unwrap()
        .checked_div(total_lp_supply)
        .unwrap()) as u64;

    require!(xusd_amount > 0, ErrorCode::InvalidAmount);

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info().key(),
            Burn {
                mint: ctx.accounts.lp_vault_mint.to_account_info(),
                from: ctx.accounts.user_lp_vault_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        lp_amount,
    )?;

    let bump = ctx.accounts.vault.bump;
    let seeds = &[VAULT_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().key(),
            Transfer {
                from: ctx.accounts.vault_xusd_ata.to_account_info(),
                to: ctx.accounts.user_xusd_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        xusd_amount,
    )?;

    msg!(
        "Burned {} LP vault, withdrew {} XUSD",
        lp_amount,
        xusd_amount
    );
    Ok(())
}
