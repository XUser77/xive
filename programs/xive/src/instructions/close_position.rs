use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token::{Mint, Token, TokenAccount, TransferChecked};
use crate::{Position, POSITION_SEED, XUSD_MINT_ADDRESS, Xive, XIVE_SEED };
use crate::errors::XiveError;
use crate::instructions::process_position;

#[derive(Accounts)]
pub struct ClosePosition<'info> {

    #[account()]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED.as_bytes(), borrower.key().as_ref(), position.index.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = xive,
    )]
    pub program_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
        mint::authority = xive,
    )]
    pub xusd_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        address = position.collateral_mint
    )]
    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub program_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = borrower,
    )]
    pub borrower_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    pub token_program: Program<'info, Token>,
}

pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {

    let position = &mut ctx.accounts.position;
    require!(position.close_date == 0, XiveError::PositionClosed);

    if position.loan_amount > 0 {
        let dept = position.loan_amount;
        let borrower_balance = ctx.accounts.borrower_xusd_ata.amount;
        process_position::return_xusd(
           position,
           &ctx.accounts.xive,
           ctx.accounts.token_program.key(),
           ctx.accounts.xusd_mint.to_account_info(),
           ctx.accounts.borrower_xusd_ata.to_account_info(),
           ctx.accounts.program_xusd_ata.to_account_info(),
           ctx.accounts.borrower.to_account_info(),
           borrower_balance,
           dept
        )?;

        position.loan_amount = 0;
    }

    if position.collateral_amount > 0 {
        let collateral_amount = position.collateral_amount;
        position.collateral_amount = 0;

        let bump = ctx.accounts.xive.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            XIVE_SEED.as_bytes(),
            &[bump],
        ]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.program_collateral_ata.to_account_info(),
                    to: ctx.accounts.borrower_collateral_ata.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    authority: ctx.accounts.xive.to_account_info(),
                },
                signer_seeds,
            ),
            collateral_amount,
            ctx.accounts.collateral_mint.decimals,
        )?;
    }

    position.close_date = Clock::get()?.unix_timestamp;

    Ok(())

}