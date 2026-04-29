use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use collaterals::{Collateral, COLLATERAL_SEED};
use fees::{Fees, FEES_SEED};

use crate::error::ErrorCode;
use crate::util::{commission_amount, max_loan_xusd};
use crate::{Position, Xive};
use crate::{PEG_KEEPER_PROGRAM_ID, PEG_KEEPER_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Box<Account<'info, Xive>>,

    #[account(
        mut,
        has_one = user,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), position.collateral_mint.as_ref()],
        seeds::program = collaterals::ID,
        bump = collateral.bump,
        constraint = collateral.price > 0 @ ErrorCode::ZeroPrice,
    )]
    pub collateral: Box<Account<'info, Collateral>>,

    #[account(address = position.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,

    /// CHECK: peg_keeper PDA — address derived from well-known program ID and seed
    #[account(
        mut,
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        seeds::program = peg_keeper_program,
        bump,
    )]
    pub peg_keeper: UncheckedAccount<'info>,

    #[account(mut, address = peg_keeper::XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = user,
    )]
    pub user_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        seeds = [FEES_SEED.as_bytes()],
        seeds::program = fees::ID,
        bump = fees.bump,
    )]
    pub fees: Box<Account<'info, Fees>>,

    /// fees-PDA-owned XUSD ATA — accumulates borrow commissions until `fees::withdraw_fees`.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = xusd_mint,
        associated_token::authority = fees,
    )]
    pub fees_xusd_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub peg_keeper_program: Program<'info, peg_keeper::program::PegKeeper>,
}

pub fn handler(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let position = &mut ctx.accounts.position;
    let collateral = &ctx.accounts.collateral;

    // The user receives `amount` XUSD; the commission is added on top of the recorded debt.
    let fee = commission_amount(amount, ctx.accounts.xive.commission_bps);
    let debt_increase = amount.checked_add(fee).unwrap();
    let new_loan = position.loan_amount.checked_add(debt_increase).unwrap();

    let max_loan = max_loan_xusd(
        position.collateral_amount,
        collateral.price,
        collateral.ltv,
        ctx.accounts.collateral_mint.decimals,
    );
    require!(new_loan as u128 <= max_loan, ErrorCode::InsufficientCollateral);

    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    if amount > 0 {
        peg_keeper::cpi::mint_xusd(
            CpiContext::new_with_signer(
                PEG_KEEPER_PROGRAM_ID,
                peg_keeper::cpi::accounts::MintXusd {
                    peg_keeper: ctx.accounts.peg_keeper.to_account_info(),
                    xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                    recipient_token_account: ctx.accounts.user_xusd_ata.to_account_info(),
                    xive: ctx.accounts.xive.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
    }

    if fee > 0 {
        peg_keeper::cpi::mint_xusd(
            CpiContext::new_with_signer(
                PEG_KEEPER_PROGRAM_ID,
                peg_keeper::cpi::accounts::MintXusd {
                    peg_keeper: ctx.accounts.peg_keeper.to_account_info(),
                    xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                    recipient_token_account: ctx.accounts.fees_xusd_ata.to_account_info(),
                    xive: ctx.accounts.xive.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            fee,
        )?;
    }

    position.loan_amount = new_loan;

    msg!(
        "Borrowed {} XUSD to user (+{} fee), new debt {}",
        amount,
        fee,
        position.loan_amount
    );
    Ok(())
}
