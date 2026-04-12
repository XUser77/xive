use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{error::ErrorCode, Loan, Xive, LOAN_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct TakeLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    /// Collateral record — read price from here
    #[account(
        seeds = [collateral::COLLATERAL_SEED.as_bytes(), collateral_token_mint.key().as_ref()],
        bump = collateral.bump,
        seeds::program = collateral_program.key(),
        constraint = collateral.token_mint == collateral_token_mint.key(),
    )]
    pub collateral: Box<Account<'info, collateral::Collateral>>,

    pub collateral_token_mint: Box<Account<'info, Mint>>,

    /// Borrower's collateral token account (source)
    #[account(
        mut,
        associated_token::mint = collateral_token_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_account: Account<'info, TokenAccount>,

    /// Vault holding collateral (owned by xive PDA)
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = collateral_token_mint,
        associated_token::authority = xive,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Loan record PDA
    #[account(
        init,
        payer = borrower,
        space = 8 + Loan::INIT_SPACE,
        seeds = [LOAN_SEED.as_bytes(), borrower.key().as_ref(), collateral_token_mint.key().as_ref()],
        bump,
    )]
    pub loan: Account<'info, Loan>,

    /// PegKeeper singleton (cross-program PDA)
    #[account(
        seeds = [peg_keeper::PEG_KEEPER_SEED.as_bytes()],
        bump = peg_keeper_account.bump,
        seeds::program = peg_keeper_program.key(),
    )]
    pub peg_keeper_account: Box<Account<'info, peg_keeper::PegKeeper>>,

    /// XUSD mint (owned by peg_keeper)
    #[account(
        mut,
        address = peg_keeper_account.xusd_mint,
    )]
    pub xusd_mint: Account<'info, Mint>,

    /// Borrower's XUSD token account (destination)
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = xusd_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_xusd_account: Account<'info, TokenAccount>,

    pub peg_keeper_program: Program<'info, peg_keeper::program::PegKeeper>,
    pub collateral_program: Program<'info, collateral::program::Collateral>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<TakeLoan>, collateral_amount: u64) -> Result<()> {
    let collateral = &ctx.accounts.collateral;
    let collateral_decimals = ctx.accounts.collateral_token_mint.decimals;

    require!(collateral.price > 0, ErrorCode::ZeroPrice);

    // xusd_amount = collateral_amount * price / 10^collateral_decimals
    // price is in XUSD base units (6 decimals), e.g. $3000 = 3_000_000_000
    let xusd_amount = (collateral_amount as u128)
        .checked_mul(collateral.price as u128)
        .unwrap()
        .checked_div(10u128.pow(collateral_decimals as u32))
        .unwrap() as u64;

    require!(xusd_amount > 0, ErrorCode::InsufficientCollateral);

    // Transfer collateral from borrower to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.borrower_collateral_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        collateral_amount,
    )?;

    // CPI to peg_keeper to mint XUSD
    let seeds = &[XIVE_SEED.as_bytes(), &[ctx.accounts.xive.bump]];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = peg_keeper::cpi::accounts::MintXusd {
        peg_keeper: ctx.accounts.peg_keeper_account.to_account_info(),
        authorized_minter: ctx.accounts.xive.to_account_info(),
        xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
        recipient_token_account: ctx.accounts.borrower_xusd_account.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };

    peg_keeper::cpi::mint_xusd(
        CpiContext::new_with_signer(
            ctx.accounts.peg_keeper_program.key(),
            cpi_accounts,
            signer_seeds,
        ),
        xusd_amount,
    )?;

    // Record loan
    let now = Clock::get()?.unix_timestamp;
    let loan = &mut ctx.accounts.loan;
    loan.borrower = ctx.accounts.borrower.key();
    loan.collateral_mint = ctx.accounts.collateral_token_mint.key();
    loan.collateral_amount = collateral_amount;
    loan.xusd_borrowed = xusd_amount;
    loan.created_at = now;
    loan.bump = ctx.bumps.loan;

    msg!("Loan created — deposited {} collateral, borrowed {} XUSD", collateral_amount, xusd_amount);
    Ok(())
}
