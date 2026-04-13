use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::{Collateral, Position, UserCounter, Xive};
use crate::{COLLATERAL_SEED, PEG_KEEPER_PROGRAM_ID, PEG_KEEPER_SEED, POSITION_SEED, USER_COUNTER_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct Lend<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump = collateral.bump,
        constraint = collateral.allowed @ ErrorCode::CollateralNotAllowed,
        constraint = collateral.price > 0 @ ErrorCode::ZeroPrice,
    )]
    pub collateral: Account<'info, Collateral>,

    /// CHECK: only used as address for ATA derivation and position record
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = user,
    )]
    pub user_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = xusd_mint,
        associated_token::authority = user,
    )]
    pub user_xusd_ata: Account<'info, TokenAccount>,

    /// CHECK: peg_keeper PDA — address derived from well-known program ID and seed
    #[account(
        mut,
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        seeds::program = PEG_KEEPER_PROGRAM_ID.parse::<Pubkey>().unwrap(),
        bump,
    )]
    pub peg_keeper: UncheckedAccount<'info>,

    #[account(mut, address = peg_keeper::XUSD_MINT.parse::<Pubkey>().unwrap())]
    pub xusd_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserCounter::INIT_SPACE,
        seeds = [USER_COUNTER_SEED.as_bytes(), user.key().as_ref()],
        bump,
    )]
    pub user_counter: Account<'info, UserCounter>,

    #[account(
        init,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED.as_bytes(), user.key().as_ref(), &user_counter.counter.to_le_bytes()],
        bump,
    )]
    pub position: Account<'info, Position>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Lend>, collateral_amount: u64, loan_amount: u64) -> Result<()> {
    let collateral = &ctx.accounts.collateral;

    // LTV check: loan_amount <= collateral_amount * price * ltv / 100
    // price = XUSD micro-units per 1 raw collateral unit
    let max_loan = (collateral_amount as u128)
        .checked_mul(collateral.price as u128)
        .unwrap()
        .checked_mul(collateral.ltv as u128)
        .unwrap()
        .checked_div(100)
        .unwrap();

    require!(loan_amount as u128 <= max_loan, ErrorCode::InsufficientCollateral);

    // Transfer collateral from user to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_collateral_ata.to_account_info(),
                to: ctx.accounts.vault_collateral_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        collateral_amount,
    )?;

    // CPI to peg_keeper: mint XUSD to user — xive PDA signs as both xive and authorized_minter
    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    peg_keeper::cpi::mint_xusd(
        CpiContext::new_with_signer(
            PEG_KEEPER_PROGRAM_ID.parse::<Pubkey>().unwrap(),
            peg_keeper::cpi::accounts::MintXusd {
                peg_keeper: ctx.accounts.peg_keeper.to_account_info(),
                authorized_minter: ctx.accounts.xive.to_account_info(),
                xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                recipient_token_account: ctx.accounts.user_xusd_ata.to_account_info(),
                xive: ctx.accounts.xive.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            signer_seeds,
        ),
        loan_amount,
    )?;

    // Record position
    let position = &mut ctx.accounts.position;
    position.bump = ctx.bumps.position;
    position.user = ctx.accounts.user.key();
    position.collateral_mint = ctx.accounts.collateral_mint.key();
    position.collateral_amount = collateral_amount;
    position.loan_amount = loan_amount;

    // Increment counter (used as nonce for next position PDA)
    let user_counter = &mut ctx.accounts.user_counter;
    user_counter.bump = ctx.bumps.user_counter;
    user_counter.counter = user_counter.counter.checked_add(1).unwrap();

    msg!(
        "Position opened: {} collateral → {} XUSD",
        collateral_amount,
        loan_amount
    );
    Ok(())
}
