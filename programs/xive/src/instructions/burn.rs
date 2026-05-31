use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Token, TokenAccount};
use crate::{Xive, XIVE_SEED, VAULT_ADDRESS, TEAM_ADDRESS, XUSD_MINT_ADDRESS };
use crate::errors::XiveError;

#[derive(Accounts)]
pub struct Burn<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
        mint::authority = xive,
    )]
    pub xusd_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(
        associated_token::mint = xusd_mint,
        associated_token::authority = signer,
    )]
    pub signer_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn burn(ctx: Context<Burn>, amount: u64) -> Result<()> {

    require!(
        [VAULT_ADDRESS, TEAM_ADDRESS].contains(&ctx.accounts.signer.key()),
        XiveError::InvalidSigner
    );

    let xive = &mut ctx.accounts.xive;

    let val = i64::try_from(amount).map_err(|_| XiveError::MathOverflow)?;

    if TEAM_ADDRESS == ctx.accounts.signer.key() {
        xive.team_balance = xive.team_balance.checked_add(val).ok_or(XiveError::MathOverflow)?;
    } else if VAULT_ADDRESS == ctx.accounts.signer.key() {
        xive.vault_balance = xive.vault_balance.checked_add(val).ok_or(XiveError::MathOverflow)?;
    }

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                from: ctx.accounts.signer_ata.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            }
        ),
        amount
    )?;

    Ok(())
}