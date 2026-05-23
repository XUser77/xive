use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{ COLLATERAL_SEED , XIVE_SEED };
use crate::errors::XiveError;
use crate::state::collateral::Collateral;
use crate::state::xive::Xive;

#[derive(Accounts)]
pub struct UpdateCollateral<'info> {

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account()]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Collateral::INIT_SPACE,
        seeds = [COLLATERAL_SEED.as_bytes(), mint.key().as_ref()],
        bump,
    )]
    pub collateral: Account<'info, Collateral>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = xive,
    )]
    pub program_collateral_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn update_collateral(ctx: Context<UpdateCollateral>, enabled: bool, ltv: u16, liquidation_ltv: u16) -> Result<()> {
    require!(ltv              <= 10_000, XiveError::InvalidLtv);          // ≤ 100%
    require!(liquidation_ltv  <= 10_000, XiveError::InvalidLtv);          // ≤ 100%
    require!(ltv              <= liquidation_ltv, XiveError::InvalidLtv); // max LTV ≤ liq threshold

    // TODO: Check authority

    let collateral = &mut ctx.accounts.collateral;
    collateral.bump = ctx.bumps.collateral;
    collateral.mint = ctx.accounts.mint.key();

    collateral.enabled = enabled;
    collateral.ltv = ltv;
    collateral.liquidation_ltv = liquidation_ltv;

    Ok(())
}