use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use collaterals::{Collateral, COLLATERAL_SEED};

use crate::error::ErrorCode;
use crate::util::liquidation_threshold_xusd;
use crate::{Position, Xive};
use crate::{VAULT_PROGRAM_ID, VAULT_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        seeds::program = VAULT_PROGRAM_ID,
        bump,
    )]
    pub caller: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Box<Account<'info, Xive>>,

    #[account(
        seeds = [COLLATERAL_SEED.as_bytes(), position.collateral_mint.as_ref()],
        seeds::program = collaterals::ID,
        bump = collateral.bump,
        constraint = collateral.price > 0 @ ErrorCode::ZeroPrice,
    )]
    pub collateral: Box<Account<'info, Collateral>>,

    #[account(mut)]
    pub position: Box<Account<'info, Position>>,

    #[account(mut, address = peg_keeper::XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = caller,
    )]
    pub caller_xusd_ata: Box<Account<'info, TokenAccount>>,

    #[account(address = position.collateral_mint)]
    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = caller,
    )]
    pub caller_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let collateral = &ctx.accounts.collateral;
    let debt = position.loan_amount;
    let collateral_amount = position.collateral_amount;

    require!(debt > 0, ErrorCode::InvalidAmount);

    let liquidation_tvl = liquidation_threshold_xusd(
        collateral_amount,
        collateral.price,
        collateral.liquidation_ltv,
        ctx.accounts.collateral_mint.decimals,
    );
    require!(debt as u128 >= liquidation_tvl, ErrorCode::PositionHealthy);

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info().key(),
            Burn {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                from: ctx.accounts.caller_xusd_ata.to_account_info(),
                authority: ctx.accounts.caller.to_account_info(),
            },
        ),
        debt,
    )?;

    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().key(),
            Transfer {
                from: ctx.accounts.vault_collateral_ata.to_account_info(),
                to: ctx.accounts.caller_collateral_ata.to_account_info(),
                authority: ctx.accounts.xive.to_account_info(),
            },
            signer_seeds,
        ),
        collateral_amount,
    )?;

    position.loan_amount = 0;
    position.collateral_amount = 0;

    msg!(
        "Position liquidated: burned {} XUSD, transferred {} collateral",
        debt,
        collateral_amount
    );
    Ok(())
}
