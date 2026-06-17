use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Token, TokenAccount};
use xive::cpi::accounts::Mint;
use crate::errors::VaultError;
use crate::{ Vault, Xive, XIVE_SEED, XUSD_MINT_ADDRESS };
use crate::constants::{VAULT_SEED, XIVE_PROGRAM_ID};
use xive::program::Xive as XiveProgram;

#[derive(Accounts)]
pub struct TransferFromXive<'info> {

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        seeds::program = xive_program.key()
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
        mint::authority = xive,
    )]
    pub xusd_mint: Account<'info, token::Mint>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub xive_program: Program<'info, XiveProgram>,

}

pub fn transfer_from_xive(ctx: Context<TransferFromXive>, amount: u64) -> Result<()> {

    require!(amount > 0, VaultError::ValueCannotBeZero);

    let vault = &ctx.accounts.vault;
    let bump = vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED.as_bytes(),
        &[bump],
    ]];

    xive::cpi::mint(
        CpiContext::new_with_signer(
            XIVE_PROGRAM_ID,
            Mint {
                signer: vault.to_account_info(),
                xive: ctx.accounts.xive.to_account_info(),
                xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                signer_ata: ctx.accounts.vault_ata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            },
            signer_seeds,
        ),
        amount
    )?;

    Ok(())

}