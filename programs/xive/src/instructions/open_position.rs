use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use peg_keeper::{PegKeeper, XUSD_MINT};

use crate::error::ErrorCode;
use crate::util::max_loan_xusd;
use crate::{Collateral, Position, UserCounter, Xive};
use crate::{COLLATERAL_SEED, PEG_KEEPER_SEED, POSITION_SEED, USER_COUNTER_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Box<Account<'info, Xive>>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump = collateral.bump,
        constraint = collateral.allowed @ ErrorCode::CollateralNotAllowed,
        constraint = collateral.price > 0 @ ErrorCode::ZeroPrice,
    )]
    pub collateral: Box<Account<'info, Collateral>>,

    #[account()]
    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = user,
    )]
    pub user_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = xusd_mint,
        associated_token::authority = user,
    )]
    pub user_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        seeds::program = peg_keeper_program,
        bump,
    )]
    pub peg_keeper: Box<Account<'info, PegKeeper>>,

    #[account(mut, address = XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [USER_COUNTER_SEED.as_bytes(), user.key().as_ref()],
        bump,
    )]
    pub user_counter: Box<Account<'info, UserCounter>>,

    #[account(
        init,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED.as_bytes(), user.key().as_ref(), &user_counter.counter.to_le_bytes()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub peg_keeper_program: Program<'info, peg_keeper::program::PegKeeper>,
}

pub fn handler(ctx: Context<OpenPosition>, collateral_amount: u64, loan_amount: u64) -> Result<()> {
    let collateral = &ctx.accounts.collateral;

    // price = whole XUSD per whole collateral; ltv in bps (9000 = 90%).
    let max_loan = max_loan_xusd(
        collateral_amount,
        collateral.price,
        collateral.ltv,
        ctx.accounts.collateral_mint.decimals,
    );

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
            ctx.accounts.peg_keeper_program.key(),
            peg_keeper::cpi::accounts::MintXusd {
                peg_keeper: ctx.accounts.peg_keeper.to_account_info(),
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
