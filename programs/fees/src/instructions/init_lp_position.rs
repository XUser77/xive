use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;

use crate::error::ErrorCode;
use crate::{Fees, FEES_SEED, WHIRLPOOL_PROGRAM_ID};

/// LP range for the fees-owned XUSD/USDC position. Hardcoded ±100 ticks around the
/// stable peg — `withdraw_fees` increases liquidity in this exact range every call.
pub const LP_TICK_LOWER: i32 = -100;
pub const LP_TICK_UPPER: i32 = 100;

// sha256("global:open_position")[..8]
const OPEN_POSITION_DISC: [u8; 8] = [135, 128, 47, 77, 15, 152, 240, 49];

#[derive(Accounts)]
pub struct InitLpPosition<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        mut,
        seeds = [FEES_SEED.as_bytes()],
        bump = fees.bump,
        constraint = fees.lp_position_mint == Pubkey::default() @ ErrorCode::LpPositionAlreadyInitialized,
    )]
    pub fees: Box<Account<'info, Fees>>,

    /// CHECK: Orca XUSD/USDC whirlpool — used as-is by the open_position CPI.
    pub whirlpool: UncheckedAccount<'info>,

    /// New position NFT mint — caller-provided fresh keypair, initialized by Orca.
    #[account(mut)]
    pub position_mint: Signer<'info>,

    /// CHECK: Orca position PDA derived from `position_mint`. Validated by the Orca CPI.
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// CHECK: ATA(fees, position_mint) — initialized by Orca's open_position handler.
    #[account(mut)]
    pub position_token_account: UncheckedAccount<'info>,

    /// CHECK: Orca whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitLpPosition>) -> Result<()> {
    let (expected_position, position_bump) = Pubkey::find_program_address(
        &[b"position", ctx.accounts.position_mint.key().as_ref()],
        &WHIRLPOOL_PROGRAM_ID,
    );
    require_keys_eq!(
        expected_position,
        ctx.accounts.position.key(),
        ErrorCode::PositionMintMismatch
    );

    // Args: bumps(OpenPositionBumps { position_bump: u8 }) | tick_lower(i32) | tick_upper(i32)
    let mut data = Vec::with_capacity(8 + 1 + 4 + 4);
    data.extend_from_slice(&OPEN_POSITION_DISC);
    data.push(position_bump);
    data.extend_from_slice(&LP_TICK_LOWER.to_le_bytes());
    data.extend_from_slice(&LP_TICK_UPPER.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(ctx.accounts.funder.key(), true),
        AccountMeta::new_readonly(ctx.accounts.fees.key(), false), // owner — receives the NFT
        AccountMeta::new(ctx.accounts.position.key(), false),
        AccountMeta::new(ctx.accounts.position_mint.key(), true),
        AccountMeta::new(ctx.accounts.position_token_account.key(), false),
        AccountMeta::new_readonly(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
        AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),
    ];

    let ix = Instruction {
        program_id: WHIRLPOOL_PROGRAM_ID,
        accounts,
        data,
    };

    let infos = [
        ctx.accounts.funder.to_account_info(),
        ctx.accounts.fees.to_account_info(),
        ctx.accounts.position.to_account_info(),
        ctx.accounts.position_mint.to_account_info(),
        ctx.accounts.position_token_account.to_account_info(),
        ctx.accounts.whirlpool.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info(),
        ctx.accounts.whirlpool_program.to_account_info(),
    ];

    invoke(&ix, &infos)?;

    let fees = &mut ctx.accounts.fees;
    fees.lp_position_mint = ctx.accounts.position_mint.key();
    fees.lp_whirlpool = ctx.accounts.whirlpool.key();

    msg!(
        "LP position opened: mint={} pool={} ticks=[{}, {}]",
        fees.lp_position_mint,
        fees.lp_whirlpool,
        LP_TICK_LOWER,
        LP_TICK_UPPER,
    );
    Ok(())
}
