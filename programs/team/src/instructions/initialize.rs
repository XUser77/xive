use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Mint, MintTo, Token, TokenAccount};
use crate::Team;
use crate::{ XIVE_TOKEN_ADDRESS, VE_XIVE_TOKEN_ADDRESS };
use crate::constants::{TEAM_SEED, XIVE_TOKEN_SUPPLY};

#[derive(Accounts)]
pub struct Initialize<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + Team::INIT_SPACE,
        seeds = [TEAM_SEED.as_bytes()],
        bump,
    )]
    pub team: Account<'info, Team>,

    #[account(
        init,
        payer = signer,
        address = XIVE_TOKEN_ADDRESS,
        mint::decimals = 6,
        mint::authority = team,
        mint::freeze_authority = team,
    )]
    pub xive_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = signer,
        address = VE_XIVE_TOKEN_ADDRESS,
        mint::decimals = 6,
        mint::authority = team,
        mint::freeze_authority = team,
    )]
    pub ve_xive_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = signer,
        associated_token::mint = xive_mint,
        associated_token::authority = signer,
    )]
    pub signer_xive_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.team.bump = ctx.bumps.team;

    let bump = ctx.accounts.team.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TEAM_SEED.as_bytes(),
        &[bump],
    ]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.xive_mint.to_account_info(),
                to: ctx.accounts.signer_xive_ata.to_account_info(),
                authority: ctx.accounts.team.to_account_info(),
            },
            signer_seeds,
        ),
        XIVE_TOKEN_SUPPLY,
    )?;

    Ok(())
}
