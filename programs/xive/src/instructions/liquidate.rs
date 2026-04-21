use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::{Collateral, Position, Xive};
use crate::{COLLATERAL_SEED, XIVE_SEED};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED.as_bytes(), position.collateral_mint.as_ref()],
        bump = collateral.bump,
        constraint = collateral.price > 0 @ ErrorCode::ZeroPrice,
    )]
    pub collateral: Account<'info, Collateral>,

    #[account(mut)]
    pub position: Account<'info, Position>,

    #[account(mut, address = peg_keeper::XUSD_MINT)]
    pub xusd_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = caller,
    )]
    pub caller_xusd_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = xusd_mint,
        associated_token::authority = xive,
    )]
    pub xive_xusd_ata: Account<'info, TokenAccount>,

    /// CHECK: only used as address for ATA derivation; validated via position.collateral_mint
    #[account(address = position.collateral_mint)]
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = caller,
    )]
    pub caller_collateral_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub vault_collateral_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let collateral = &ctx.accounts.collateral;
    let debt = position.loan_amount;
    let collateral_amount = position.collateral_amount;

    require!(debt > 0, ErrorCode::InvalidAmount);

    let tvl = (collateral_amount as u128)
        .checked_mul(collateral.price as u128)
        .unwrap();
    let liquidation_tvl = tvl
        .checked_mul(collateral.liquidation_ltv as u128)
        .unwrap()
        .checked_div(100)
        .unwrap();
    require!(debt as u128 >= liquidation_tvl, ErrorCode::PositionHealthy);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.caller_xusd_ata.to_account_info(),
                to: ctx.accounts.xive_xusd_ata.to_account_info(),
                authority: ctx.accounts.caller.to_account_info(),
            },
        ),
        debt,
    )?;

    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                from: ctx.accounts.xive_xusd_ata.to_account_info(),
                authority: ctx.accounts.xive.to_account_info(),
            },
            signer_seeds,
        ),
        debt,
    )?;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
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
        "Position liquidated: repaid {} XUSD, transferred {} collateral",
        debt,
        collateral_amount
    );
    Ok(())
}
