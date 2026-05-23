use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{ Mint, MintTo, Token, TokenAccount };
use crate::{ Position, POSITION_SEED, Wallet, WALLET_SEED, XUSD_MINT_ADDRESS, XIVE_SEED, COLLATERAL_SEED };
use crate::errors::XiveError;
use crate::state::collateral::Collateral;
use crate::state::xive::Xive;
use crate::utils::{ get_fee };

#[derive(Accounts)]
pub struct OpenPosition<'info> {

    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
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
    pub borrower_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), collateral_mint.key().as_ref()],
        bump = collateral.bump,
        constraint = collateral.enabled @ XiveError::CollateralDisabled,
    )]
    pub collateral: Account<'info, Collateral>,

    #[account(
        address = XUSD_MINT_ADDRESS
    )]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn open_position(ctx: Context<OpenPosition>, collateral_amount: u64, loan_amount: u64) -> Result<()> {
    require!(collateral_amount > 0, XiveError::CollateralZero);
    require!(loan_amount > 0, XiveError::LoanZero);

    let position = &mut ctx.accounts.position;

    position.bump = ctx.bumps.position;

    position.borrower = ctx.accounts.borrower.key();
    position.index = ctx.accounts.wallet.index;
    position.collateral_mint = ctx.accounts.collateral_mint.key();

    ctx.accounts.wallet.index += 1;

    // TODO: Check collateral TVL

    // TODO: Transfer collateral from user to program

    position.collateral_amount = collateral_amount;
    position.loan_amount = loan_amount;

    // TODO: Check fee calculation
    let fee = get_fee(position.loan_amount, ctx.accounts.xive.loan_fee)?;
    let borrower_xusd = position.loan_amount.checked_sub(fee).ok_or(XiveError::MathOverflow)?;

    let bump = ctx.accounts.xive.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        XIVE_SEED.as_bytes(),
        &[bump],
    ]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                to: ctx.accounts.borrower_xusd_ata.to_account_info(),
                authority: ctx.accounts.xive.to_account_info(),
            },
            signer_seeds
        ),
        borrower_xusd
    )?;

    // TODO: Mint fee

    Ok(())
}