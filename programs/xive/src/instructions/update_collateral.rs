use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::{COLLATERAL_SEED};
use crate::state::collateral::Collateral;

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

    pub system_program: Program<'info, System>,
}

pub fn update_collateral(ctx: Context<UpdateCollateral>, enabled: bool, tvl: u16, liquidation_tvl: u16) -> Result<()> {
    // TODO: Check authority

    let collateral = &mut ctx.accounts.collateral;
    collateral.bump = ctx.bumps.collateral;
    collateral.mint = ctx.accounts.mint.key();

    collateral.enabled = enabled;
    collateral.tvl = tvl;
    collateral.liquidation_tlv = liquidation_tvl;

    Ok(())
}