use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use xive::state::Position;

use crate::{Vault, VAULT_SEED, XUSD_MINT};

/// Self-funded liquidation: vault flash-mints exactly the position's debt via peg_keeper,
/// burns it through `xive::liquidate`, and walks away with the seized collateral. Net XUSD
/// supply change is zero (mint and burn cancel out); the vault's profit is the seized
/// collateral, which it can sell at leisure in a separate transaction.
#[derive(Accounts)]
pub struct FlashLoanLiquidate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    // ---------- xive accounts ----------
    pub xive_program: Program<'info, xive::program::Xive>,

    /// CHECK: xive singleton PDA — validated by xive CPI.
    #[account(mut)]
    pub xive_state: UncheckedAccount<'info>,

    /// CHECK: xive collateral PDA — validated by xive CPI via position.collateral_mint.
    #[account(mut)]
    pub xive_collateral: UncheckedAccount<'info>,

    /// CHECK: position account — validated by xive CPI.
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    #[account(mut, address = XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated by xive CPI via position.collateral_mint.
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: xive's collateral ATA — validated by xive CPI.
    #[account(mut)]
    pub xive_collateral_ata: UncheckedAccount<'info>,

    // ---------- peg_keeper accounts (forwarded to xive::flash_mint_for_liquidation) ----------
    pub peg_keeper_program: Program<'info, peg_keeper::program::PegKeeper>,

    /// CHECK: peg_keeper PDA — validated by peg_keeper CPI.
    #[account(mut)]
    pub peg_keeper: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FlashLoanLiquidate>) -> Result<()> {
    // Read position debt before liquidating — we need to flash-mint exactly this much.
    let debt = read_loan_amount(&ctx.accounts.position)?;

    let bump = ctx.accounts.vault.bump;
    let seeds: &[&[u8]] = &[VAULT_SEED.as_bytes(), std::slice::from_ref(&bump)];
    let signer_seeds = &[seeds];

    // 1. Flash-mint `debt` XUSD into vault's XUSD ATA (xive co-signs as authorized minter).
    xive::cpi::flash_mint_for_liquidation(
        CpiContext::new_with_signer(
            ctx.accounts.xive_program.to_account_info().key(),
            xive::cpi::accounts::FlashMintForLiquidation {
                caller: ctx.accounts.vault.to_account_info(),
                xive: ctx.accounts.xive_state.to_account_info(),
                xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                caller_xusd_ata: ctx.accounts.vault_xusd_ata.to_account_info(),
                peg_keeper: ctx.accounts.peg_keeper.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                peg_keeper_program: ctx.accounts.peg_keeper_program.to_account_info(),
            },
            signer_seeds,
        ),
        debt,
    )?;

    // 2. Liquidate — xive burns the freshly-minted XUSD from vault and transfers all
    //    seized collateral into the vault's collateral ATA.
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

    msg!("Flash-loan liquidation: burned {} XUSD, seized collateral", debt);
    Ok(())
}

fn read_loan_amount(position: &UncheckedAccount) -> Result<u64> {
    let data = position.try_borrow_data()?;
    let pos = Position::try_deserialize(&mut &data[..])?;
    Ok(pos.loan_amount)
}
