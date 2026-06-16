use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Token, TokenAccount, TransferChecked};
use anchor_spl::token::Mint;
use crate::{Team, TeamError, XUSD_MINT_ADDRESS};
use crate::constants::{STAKE_SEED, TEAM_SEED};
use crate::state::stake::Stake;

#[derive(Accounts)]
pub struct Claim<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [TEAM_SEED.as_bytes()],
        bump = team.bump,
    )]
    pub team: Account<'info, Team>,

    #[account(
        mut,
        seeds = [STAKE_SEED.as_bytes(), signer.key().as_ref()],
        bump = stake.bump,
    )]
    pub stake: Account<'info, Stake>,

    #[account(
        address = XUSD_MINT_ADDRESS,
    )]
    pub xusd_mint: Account<'info, Mint>,

    // reward vault — xUSD that transfer_from_xive minted in
    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = team,
    )]
    pub team_ata: Account<'info, TokenAccount>,

    // claimer's xUSD destination
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = xusd_mint,
        associated_token::authority = signer,
    )]
    pub signer_xusd_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn claim(ctx: Context<Claim>) -> Result<()> {

    let acc = ctx.accounts.team.acc_xusd_per_share;

    let payout;
    {
        let stake = &mut ctx.accounts.stake;
        stake.harvest(acc)?;
        payout = stake.pending;
        require!(payout > 0, TeamError::NothingToClaim);
        stake.pending = 0;
    }

    let bump = ctx.accounts.team.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TEAM_SEED.as_bytes(),
        &[bump],
    ]];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.team_ata.to_account_info(),
                to: ctx.accounts.signer_xusd_ata.to_account_info(),
                mint: ctx.accounts.xusd_mint.to_account_info(),
                authority: ctx.accounts.team.to_account_info(),
            },
            signer_seeds,
        ),
        payout,
        ctx.accounts.xusd_mint.decimals,
    )?;

    Ok(())
}
