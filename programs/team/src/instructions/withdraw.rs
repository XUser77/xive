use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{Burn, FreezeAccount, Mint, ThawAccount, Token, TokenAccount, TransferChecked};
use crate::{Team, TeamError, XIVE_TOKEN_ADDRESS, VE_XIVE_TOKEN_ADDRESS};
use crate::constants::{STAKE_SEED, TEAM_SEED};
use crate::state::stake::Stake;

#[derive(Accounts)]
pub struct Withdraw<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
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

    #[account(address = XIVE_TOKEN_ADDRESS)]
    pub xive_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = VE_XIVE_TOKEN_ADDRESS,
        mint::authority = team,
        mint::freeze_authority = team,
    )]
    pub ve_xive_mint: Account<'info, Mint>,

    // user's XIVE — destination of the returned tokens
    #[account(
        mut,
        associated_token::mint = xive_mint,
        associated_token::authority = signer,
    )]
    pub signer_xive_ata: Account<'info, TokenAccount>,

    // team-owned escrow holding the locked XIVE
    #[account(
        mut,
        associated_token::mint = xive_mint,
        associated_token::authority = team,
    )]
    pub team_xive_ata: Account<'info, TokenAccount>,

    // user's veXIVE — burned on withdraw (frozen until thawed below)
    #[account(
        mut,
        associated_token::mint = ve_xive_mint,
        associated_token::authority = signer,
    )]
    pub signer_ve_xive_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {

    require!(amount > 0, TeamError::ValueCannotBeZero);

    // 1) checkpoint the staker, then reduce the stake
    let acc = ctx.accounts.team.acc_xusd_per_share;
    let remaining;
    {
        let stake = &mut ctx.accounts.stake;
        require!(stake.amount >= amount, TeamError::InsufficientStake);
        stake.harvest(acc)?;
        stake.amount = stake.amount.checked_sub(amount).ok_or(TeamError::MathOverflow)?;
        stake.sync_debt(acc)?;
        remaining = stake.amount;
    }
    ctx.accounts.team.total_staked = ctx.accounts.team.total_staked
        .checked_sub(amount).ok_or(TeamError::MathOverflow)?;

    let bump = ctx.accounts.team.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TEAM_SEED.as_bytes(),
        &[bump],
    ]];

    // 2) thaw and burn the user's veXIVE (thaw via team freeze authority, burn via user)
    token::thaw_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            ThawAccount {
                account: ctx.accounts.signer_ve_xive_ata.to_account_info(),
                mint: ctx.accounts.ve_xive_mint.to_account_info(),
                authority: ctx.accounts.team.to_account_info(),
            },
            signer_seeds,
        ),
    )?;

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.ve_xive_mint.to_account_info(),
                from: ctx.accounts.signer_ve_xive_ata.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        amount,
    )?;

    // re-freeze only if the user still has a staked position
    if remaining > 0 {
        token::freeze_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                FreezeAccount {
                    account: ctx.accounts.signer_ve_xive_ata.to_account_info(),
                    mint: ctx.accounts.ve_xive_mint.to_account_info(),
                    authority: ctx.accounts.team.to_account_info(),
                },
                signer_seeds,
            ),
        )?;
    }

    // 3) return XIVE 1:1 from the escrow (team PDA signs)
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.team_xive_ata.to_account_info(),
                to: ctx.accounts.signer_xive_ata.to_account_info(),
                mint: ctx.accounts.xive_mint.to_account_info(),
                authority: ctx.accounts.team.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.xive_mint.decimals,
    )?;

    Ok(())
}
