use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Mint, MintTo, Token, TokenAccount, TransferChecked};
use crate::{Team, TeamError, XIVE_TOKEN_ADDRESS, VE_XIVE_TOKEN_ADDRESS};
use crate::constants::TEAM_SEED;

#[derive(Accounts)]
pub struct Deposit<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [TEAM_SEED.as_bytes()],
        bump = team.bump,
    )]
    pub team: Account<'info, Team>,

    #[account(address = XIVE_TOKEN_ADDRESS)]
    pub xive_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = VE_XIVE_TOKEN_ADDRESS,
        mint::authority = team,
    )]
    pub ve_xive_mint: Account<'info, Mint>,

    // user's XIVE — source of the deposit
    #[account(
        mut,
        associated_token::mint = xive_mint,
        associated_token::authority = signer,
    )]
    pub signer_xive_ata: Account<'info, TokenAccount>,

    // team-owned escrow that holds the locked XIVE
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = xive_mint,
        associated_token::authority = team,
    )]
    pub team_xive_ata: Account<'info, TokenAccount>,

    // user's veXIVE — destination of the minted shares
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = ve_xive_mint,
        associated_token::authority = signer,
    )]
    pub signer_ve_xive_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {

    require!(amount > 0, TeamError::ValueCannotBeZero);

    // 1) move XIVE from the user into the team escrow (user signs)
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.signer_xive_ata.to_account_info(),
                to: ctx.accounts.team_xive_ata.to_account_info(),
                mint: ctx.accounts.xive_mint.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.xive_mint.decimals,
    )?;

    // 2) mint veXIVE 1:1 to the user (team PDA signs)
    let bump = ctx.accounts.team.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TEAM_SEED.as_bytes(),
        &[bump],
    ]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.ve_xive_mint.to_account_info(),
                to: ctx.accounts.signer_ve_xive_ata.to_account_info(),
                authority: ctx.accounts.team.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    Ok(())
}
