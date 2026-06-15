use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Token, TokenAccount};
use xive::cpi::accounts::Mint;
use xive::program::Xive as XiveProgram;
use crate::{ Team, Xive, TeamError, XIVE_SEED, XIVE_PROGRAM_ID, XUSD_MINT_ADDRESS };
use crate::constants::TEAM_SEED;

#[derive(Accounts)]
pub struct TransferFromXive<'info> {

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [TEAM_SEED.as_ref()],
        bump = team.bump,
    )]
    pub team: Account<'info, Team>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_ref()],
        bump = xive.bump,
        seeds::program = xive_program.key()
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
        mint::authority = xive,
    )]
    pub xusd_mint: Account<'info, token::Mint>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = team,
    )]
    pub team_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub xive_program: Program<'info, XiveProgram>,

}

pub fn transfer_from_xive(ctx: Context<TransferFromXive>, amount: u64) -> Result<()> {

    require!(amount > 0, TeamError::ValueCannotBeZero);

    let team = &ctx.accounts.team;
    let bump = team.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TEAM_SEED.as_bytes(),
        &[bump],
    ]];

    xive::cpi::mint(
        CpiContext::new_with_signer(
            XIVE_PROGRAM_ID,
            Mint {
                signer: team.to_account_info(),
                xive: ctx.accounts.xive.to_account_info(),
                xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
                signer_ata: ctx.accounts.team_ata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    Ok(())
}
