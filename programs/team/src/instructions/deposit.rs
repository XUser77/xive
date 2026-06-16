use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{FreezeAccount, Mint, MintTo, ThawAccount, Token, TokenAccount, TransferChecked};
use anchor_spl::token::spl_token::state::AccountState;
use crate::{Team, TeamError, XIVE_TOKEN_ADDRESS, VE_XIVE_TOKEN_ADDRESS};
use crate::constants::{STAKE_SEED, TEAM_SEED};
use crate::state::stake::Stake;

#[derive(Accounts)]
pub struct Deposit<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [TEAM_SEED.as_bytes()],
        bump = team.bump,
    )]
    pub team: Account<'info, Team>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + Stake::INIT_SPACE,
        seeds = [STAKE_SEED.as_bytes(), signer.key().as_ref()],
        bump,
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

    // user's veXIVE — destination of the minted shares (kept frozen / non-transferable)
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

    // 2) checkpoint the staker against the current reward accumulator
    let acc = ctx.accounts.team.acc_xusd_per_share;
    {
        let stake = &mut ctx.accounts.stake;
        stake.owner = ctx.accounts.signer.key();
        stake.bump = ctx.bumps.stake;
        stake.harvest(acc)?;
        stake.amount = stake.amount.checked_add(amount).ok_or(TeamError::MathOverflow)?;
        stake.sync_debt(acc)?;
    }
    ctx.accounts.team.total_staked = ctx.accounts.team.total_staked
        .checked_add(amount).ok_or(TeamError::MathOverflow)?;

    // 3) mint veXIVE 1:1 to the user (team PDA signs), keeping the ATA frozen
    let bump = ctx.accounts.team.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TEAM_SEED.as_bytes(),
        &[bump],
    ]];

    // thaw if a prior deposit left it frozen (a fresh ATA is unfrozen)
    if ctx.accounts.signer_ve_xive_ata.state == AccountState::Frozen {
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
    }

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

    // re-freeze so veXIVE stays non-transferable
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

    Ok(())
}
