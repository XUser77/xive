use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Token, TokenAccount};
use xive::cpi::accounts::Mint;
use xive::program::Xive as XiveProgram;
use crate::{ Team, Xive, TeamError, XIVE_SEED, XIVE_PROGRAM_ID, XUSD_MINT_ADDRESS };
use crate::constants::{ACC_SCALE, TEAM_SEED};

#[derive(Accounts)]
pub struct TransferFromXive<'info> {

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [TEAM_SEED.as_bytes()],
        bump = team.bump,
    )]
    pub team: Account<'info, Team>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
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
        init_if_needed,
        payer = authority,
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

    let bump = ctx.accounts.team.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TEAM_SEED.as_bytes(),
        &[bump],
    ]];

    // pull the team's accrued fees out of xive as xUSD, into the reward vault (team_ata)
    xive::cpi::mint(
        CpiContext::new_with_signer(
            XIVE_PROGRAM_ID,
            Mint {
                signer: ctx.accounts.team.to_account_info(),
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

    // distribute to veXIVE stakers via the reward accumulator (O(1))
    let team = &mut ctx.accounts.team;
    let dist = amount.checked_add(team.undistributed).ok_or(TeamError::MathOverflow)?;

    if team.total_staked > 0 {
        let add = (dist as u128)
            .checked_mul(ACC_SCALE).ok_or(TeamError::MathOverflow)?
            .checked_div(team.total_staked as u128).ok_or(TeamError::MathOverflow)?;
        team.acc_xusd_per_share = team.acc_xusd_per_share
            .checked_add(add).ok_or(TeamError::MathOverflow)?;
        team.undistributed = 0;
    } else {
        // nobody staked yet — carry the fees forward to the next distribution
        team.undistributed = dist;
    }

    Ok(())
}
