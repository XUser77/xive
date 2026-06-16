use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token::{Mint, Token, TokenAccount, TransferChecked};
use crate::{ Position, POSITION_SEED, XIVE_SEED };
use crate::errors::XiveError;
use crate::state::xive::Xive;
use crate::utils::get_vault_pda_address;

#[derive(Accounts)]
pub struct ReturnCollateral<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED.as_bytes(), position.borrower.key().as_ref(), position.index.to_le_bytes().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        address = position.collateral_mint
    )]
    pub collateral_mint: Account<'info, Mint>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub xive_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = signer,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

}

pub fn return_collateral<'info>(ctx: Context<ReturnCollateral>, collateral_amount: u64) -> Result<()> {

    require!(ctx.accounts.signer.key() == get_vault_pda_address()?, XiveError::SignerNotVault);

    require!(ctx.accounts.position.close_date > 0, XiveError::ActivePosition);
    require!(ctx.accounts.position.loan_amount == 0, XiveError::ActivePosition);

    // move the surplus collateral back into the shared program pool (vault signs)
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                mint: ctx.accounts.collateral_mint.to_account_info(),
                from: ctx.accounts.vault_collateral_ata.to_account_info(),
                to: ctx.accounts.xive_collateral_ata.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        collateral_amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    let position = &mut ctx.accounts.position;
    position.collateral_amount = position.collateral_amount
        .checked_add(collateral_amount)
        .ok_or(XiveError::MathOverflow)?;

    Ok(())
}
