use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use peg_keeper::{PegKeeper, XUSD_MINT};

use crate::error::ErrorCode;
use crate::{Xive, VAULT_PROGRAM_ID, VAULT_SEED, XIVE_SEED, PEG_KEEPER_SEED};

/// Flash-mint XUSD into the vault's XUSD ATA so the vault can satisfy a single
/// `xive::liquidate` call without having any deposited XUSD reserves. The vault
/// is expected to immediately follow this with `xive::liquidate`, which burns
/// the same amount — net XUSD supply change is zero across the pair of calls.
#[derive(Accounts)]
pub struct FlashMintForLiquidation<'info> {
    /// Caller — must be the vault PDA, signed via `invoke_signed` with vault seeds.
    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        seeds::program = VAULT_PROGRAM_ID,
        bump,
    )]
    pub caller: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Box<Account<'info, Xive>>,

    #[account(mut, address = XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,

    /// Vault's XUSD ATA — recipient of the flash-mint.
    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = caller,
    )]
    pub caller_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        seeds::program = peg_keeper_program,
        bump,
    )]
    pub peg_keeper: Box<Account<'info, PegKeeper>>,

    pub token_program: Program<'info, Token>,
    pub peg_keeper_program: Program<'info, peg_keeper::program::PegKeeper>,
}

pub fn handler(ctx: Context<FlashMintForLiquidation>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    peg_keeper::cpi::mint_xusd(
        CpiContext::new_with_signer(
            ctx.accounts.peg_keeper_program.key(),
            peg_keeper::cpi::accounts::MintXusd {
                peg_keeper: ctx.accounts.peg_keeper.to_account_info(),
                xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                recipient_token_account: ctx.accounts.caller_xusd_ata.to_account_info(),
                xive: ctx.accounts.xive.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    msg!("Flash-minted {} XUSD to vault", amount);
    Ok(())
}
