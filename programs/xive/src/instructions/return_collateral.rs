use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::{ Position, POSITION_SEED, COLLATERAL_SEED, VAULT_ADDRESS };
use crate::errors::XiveError;
use crate::state::collateral::Collateral;

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

}

pub fn return_collateral<'info>(ctx: Context<ReturnCollateral>, collateral_amount: u64) -> Result<()> {

    require!(ctx.accounts.signer.key() == VAULT_ADDRESS, XiveError::SignerNotVault);

    let position = &mut ctx.accounts.position;
    require!(position.close_date > 0, XiveError::ActivePosition);
    require!(position.loan_amount == 0, XiveError::ActivePosition);

    // TODO: transfer collateral
    position.collateral_amount = position.collateral_amount
        .checked_add(collateral_amount)
        .ok_or(XiveError::MathOverflow)?;

    Ok(())
}
