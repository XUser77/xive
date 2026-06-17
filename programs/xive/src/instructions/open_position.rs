use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{ Mint, Token, TokenAccount };
use crate::{ Position, POSITION_SEED, Wallet, WALLET_SEED, XUSD_MINT_ADDRESS, XIVE_SEED, COLLATERAL_SEED };
use crate::errors::XiveError;
use crate::instructions::process_position::{borrow_xusd, deposit_collateral};
use crate::state::collateral::Collateral;
use crate::state::xive::Xive;

#[derive(Accounts)]
pub struct OpenPosition<'info> {

    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [WALLET_SEED.as_bytes(), borrower.key().as_ref()],
        bump = wallet.bump
    )]
    pub wallet: Account<'info, Wallet>,

    #[account(
        init,
        payer = borrower,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED.as_bytes(), borrower.key().as_ref(), wallet.index.to_le_bytes().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account()]
    pub collateral_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = xusd_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub program_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump = collateral.bump,
        constraint = collateral.enabled @ XiveError::CollateralDisabled,
    )]
    pub collateral: Account<'info, Collateral>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
        mint::authority = xive,
    )]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn open_position(ctx: Context<OpenPosition>, collateral_amount: u64, loan_amount: u64) -> Result<()> {

    let position = &mut ctx.accounts.position;

    position.bump = ctx.bumps.position;

    position.borrower = ctx.accounts.borrower.key();
    position.index = ctx.accounts.wallet.index;
    position.collateral_mint = ctx.accounts.collateral_mint.key();

    ctx.accounts.wallet.index += 1;

    deposit_collateral(
        position,
        ctx.accounts.token_program.key(),
        ctx.accounts.borrower_collateral_ata.to_account_info(),
        ctx.accounts.program_collateral_ata.to_account_info(),
        &ctx.accounts.collateral_mint,
        ctx.accounts.borrower.to_account_info(),
        collateral_amount,
    )?;

    borrow_xusd(
        position,
        &mut ctx.accounts.xive,
        ctx.accounts.token_program.key(),
        ctx.accounts.xusd_mint.to_account_info(),
        ctx.accounts.borrower_xusd_ata.to_account_info(),
        loan_amount,
        &ctx.accounts.collateral,
        &ctx.accounts.collateral_mint,
    )?;

    Ok(())
}