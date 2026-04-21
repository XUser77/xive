use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::{Vault, LP_VAULT_MINT, VAULT_SEED, XUSD_MINT};

#[derive(Accounts)]
pub struct Deposit<'info> {
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
        init_if_needed,
        payer = user,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Account<'info, TokenAccount>,

    #[account(mut, address = LP_VAULT_MINT)]
    pub lp_vault_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = lp_vault_mint,
        associated_token::authority = user,
    )]
    pub user_lp_vault_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let total_xusd_before = ctx.accounts.vault_xusd_ata.amount as u128;
    let total_lp_supply = ctx.accounts.lp_vault_mint.supply as u128;

    let mint_amount = if total_xusd_before == 0 || total_lp_supply == 0 {
        amount
    } else {
        ((amount as u128)
            .checked_mul(total_lp_supply)
            .unwrap()
            .checked_div(total_xusd_before)
            .unwrap()) as u64
    };

    require!(mint_amount > 0, ErrorCode::InvalidAmount);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info().key(),
            Transfer {
                from: ctx.accounts.user_xusd_ata.to_account_info(),
                to: ctx.accounts.vault_xusd_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    let bump = ctx.accounts.vault.bump;
    let seeds = &[VAULT_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().key(),
            MintTo {
                mint: ctx.accounts.lp_vault_mint.to_account_info(),
                to: ctx.accounts.user_lp_vault_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        mint_amount,
    )?;

    msg!(
        "Deposited {} XUSD, minted {} LP vault",
        amount,
        mint_amount
    );
    Ok(())
}
