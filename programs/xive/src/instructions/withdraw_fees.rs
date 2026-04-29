use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use peg_keeper::XUSD_MINT;

use crate::error::ErrorCode;
use crate::init_lp_position::{LP_TICK_LOWER, LP_TICK_UPPER};
use crate::{
    Xive, TEAM_FEE_SHARE_BPS, TEAM_PROGRAM_ID, TEAM_SEED, USDC_MINT, WHIRLPOOL_PROGRAM_ID,
    XIVE_SEED,
};

// sha256("global:swap")[..8]
const SWAP_DISC: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];
// sha256("global:increase_liquidity")[..8]
const INCREASE_LIQUIDITY_DISC: [u8; 8] = [46, 156, 243, 118, 13, 205, 251, 178];

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    /// Anyone can call — payer covers init_if_needed for the team's XUSD ATA on first call.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        constraint = xive.lp_position_mint != Pubkey::default() @ ErrorCode::LpPositionNotInitialized,
    )]
    pub xive: Box<Account<'info, Xive>>,

    #[account(address = XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,
    #[account(address = USDC_MINT)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = xive,
    )]
    pub xive_xusd_ata: Box<Account<'info, TokenAccount>>,

    /// xive's USDC ATA — receives the swap output and is consumed by increase_liquidity.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = xive,
    )]
    pub xive_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: team treasury PDA — derived from TEAM_PROGRAM_ID.
    #[account(
        seeds = [TEAM_SEED.as_bytes()],
        bump,
        seeds::program = TEAM_PROGRAM_ID,
    )]
    pub team: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = xusd_mint,
        associated_token::authority = team,
    )]
    pub team_xusd_ata: Box<Account<'info, TokenAccount>>,

    // ---------- Orca whirlpool accounts (XUSD/USDC pool) ----------
    /// CHECK: validated against xive.lp_whirlpool.
    #[account(mut, address = xive.lp_whirlpool @ ErrorCode::WhirlpoolMismatch)]
    pub whirlpool: UncheckedAccount<'info>,

    /// CHECK: pool's token A vault.
    #[account(mut)]
    pub token_vault_a: UncheckedAccount<'info>,
    /// CHECK: pool's token B vault.
    #[account(mut)]
    pub token_vault_b: UncheckedAccount<'info>,

    /// CHECK: tick array containing current tick — used by swap leg.
    #[account(mut)]
    pub tick_array_swap_0: UncheckedAccount<'info>,
    /// CHECK: tick array offset -1 — used by swap leg.
    #[account(mut)]
    pub tick_array_swap_1: UncheckedAccount<'info>,
    /// CHECK: tick array offset -2 — used by swap leg.
    #[account(mut)]
    pub tick_array_swap_2: UncheckedAccount<'info>,

    /// CHECK: pool oracle PDA.
    pub oracle: UncheckedAccount<'info>,

    // ---------- LP position accounts ----------
    /// CHECK: xive's existing LP position PDA — validated against xive.lp_position_mint via the
    ///   token account's mint, and via Orca's own seeds checks.
    #[account(mut)]
    pub lp_position: UncheckedAccount<'info>,

    /// CHECK: position NFT mint stored in xive state.
    #[account(address = xive.lp_position_mint @ ErrorCode::PositionMintMismatch)]
    pub lp_position_mint: UncheckedAccount<'info>,

    /// xive's ATA holding the LP position NFT.
    #[account(
        associated_token::mint = lp_position_mint,
        associated_token::authority = xive,
    )]
    pub lp_position_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: tick array containing tickLower (-100, start tick -176).
    #[account(mut)]
    pub lp_tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: tick array containing tickUpper (100, start tick 88).
    #[account(mut)]
    pub lp_tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Orca whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawFees>) -> Result<()> {
    let total = ctx.accounts.xive_xusd_ata.amount;
    require!(total > 0, ErrorCode::NoFees);

    // Split: 80% to team, 20% to LP. LP slice is half-swapped to USDC, then both sides
    // go into the LP position. Rounding always rounds the team share down.
    let team_amount = ((total as u128) * (TEAM_FEE_SHARE_BPS as u128) / 10_000) as u64;
    let lp_amount = total.checked_sub(team_amount).unwrap();
    let swap_amount = lp_amount / 2;
    let lp_xusd_amount = lp_amount.checked_sub(swap_amount).unwrap();

    let bump = ctx.accounts.xive.bump;
    let seeds = &[XIVE_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    // 1) Transfer 80% to the team treasury ATA.
    if team_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.xive_xusd_ata.to_account_info(),
                    to: ctx.accounts.team_xusd_ata.to_account_info(),
                    authority: ctx.accounts.xive.to_account_info(),
                },
                signer_seeds,
            ),
            team_amount,
        )?;
    }

    // 2) Swap half of the LP slice XUSD → USDC on the XUSD/USDC pool. mintA = XUSD,
    //    mintB = USDC (verified by ordering in init), so swap is A→B, aToB=true.
    if swap_amount > 0 {
        swap_xusd_to_usdc(&ctx, swap_amount, signer_seeds)?;
    }

    // Reload to know exactly how much USDC came out.
    ctx.accounts.xive_usdc_ata.reload()?;
    let usdc_in = ctx.accounts.xive_usdc_ata.amount;

    // 3) Increase liquidity on the LP position with (lp_xusd_amount, usdc_in).
    //    Quote the liquidity from the smaller side at the current price.
    if lp_xusd_amount > 0 && usdc_in > 0 {
        increase_liquidity(&ctx, lp_xusd_amount, usdc_in, signer_seeds)?;
    }

    msg!(
        "Fees withdrawn: total={} → team={} | LP slice={} (XUSD={} + USDC={})",
        total,
        team_amount,
        lp_amount,
        lp_xusd_amount,
        usdc_in,
    );
    Ok(())
}

fn swap_xusd_to_usdc<'info>(
    ctx: &Context<WithdrawFees<'info>>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // swap args: amount(u64) | other_amount_threshold(u64) | sqrt_price_limit(u128)
    //          | amount_specified_is_input(bool) | a_to_b(bool)
    let mut data = Vec::with_capacity(8 + 8 + 8 + 16 + 1 + 1);
    data.extend_from_slice(&SWAP_DISC);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // min out = 0 (we trust the call)
    // sqrt_price_limit = MIN_SQRT_PRICE for aToB=true (let the swap go anywhere).
    data.extend_from_slice(&4_295_048_016u128.to_le_bytes());
    data.push(1); // amount_specified_is_input = true
    data.push(1); // a_to_b = true (XUSD = mintA → USDC = mintB)

    let accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.xive.key(), true), // token_authority
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new(ctx.accounts.xive_xusd_ata.key(), false), // owner A
        AccountMeta::new(ctx.accounts.token_vault_a.key(), false),
        AccountMeta::new(ctx.accounts.xive_usdc_ata.key(), false), // owner B
        AccountMeta::new(ctx.accounts.token_vault_b.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_swap_0.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_swap_1.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_swap_2.key(), false),
        AccountMeta::new_readonly(ctx.accounts.oracle.key(), false),
    ];

    let ix = Instruction {
        program_id: WHIRLPOOL_PROGRAM_ID,
        accounts,
        data,
    };

    let infos = [
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.xive.to_account_info(),
        ctx.accounts.whirlpool.to_account_info(),
        ctx.accounts.xive_xusd_ata.to_account_info(),
        ctx.accounts.token_vault_a.to_account_info(),
        ctx.accounts.xive_usdc_ata.to_account_info(),
        ctx.accounts.token_vault_b.to_account_info(),
        ctx.accounts.tick_array_swap_0.to_account_info(),
        ctx.accounts.tick_array_swap_1.to_account_info(),
        ctx.accounts.tick_array_swap_2.to_account_info(),
        ctx.accounts.oracle.to_account_info(),
        ctx.accounts.whirlpool_program.to_account_info(),
    ];
    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}

fn increase_liquidity<'info>(
    ctx: &Context<WithdrawFees<'info>>,
    max_xusd: u64,
    max_usdc: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // We don't have access to the whirlpool price/tick math on-chain to compute the exact
    // liquidity_amount, so we ask Orca to consume up to the available amounts — passing
    // u128::MAX as liquidity would over-mint, so use a conservative estimate based on
    // the smaller side (works for the stable peg ±100 ticks where tokenA/tokenB ratio ≈ 1).
    //
    // Approx: at ±100 ticks, depositing X of either side yields L ≈ X * 200 (each tick
    // spans ~0.005 sqrt-price units, so the position holds ~2 * 100 = 200 * X). We use a
    // safe lower bound — Orca will revert if either max is exceeded, so over-estimating
    // reverts and under-estimating just leaves dust.
    let liquidity_estimate = (max_xusd.min(max_usdc) as u128).saturating_mul(180);

    // Args: liquidity_amount(u128) | token_max_a(u64) | token_max_b(u64)
    let mut data = Vec::with_capacity(8 + 16 + 8 + 8);
    data.extend_from_slice(&INCREASE_LIQUIDITY_DISC);
    data.extend_from_slice(&liquidity_estimate.to_le_bytes());
    data.extend_from_slice(&max_xusd.to_le_bytes());
    data.extend_from_slice(&max_usdc.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.xive.key(), true), // position_authority
        AccountMeta::new(ctx.accounts.lp_position.key(), false),
        AccountMeta::new_readonly(ctx.accounts.lp_position_token_account.key(), false),
        AccountMeta::new(ctx.accounts.xive_xusd_ata.key(), false), // owner A
        AccountMeta::new(ctx.accounts.xive_usdc_ata.key(), false), // owner B
        AccountMeta::new(ctx.accounts.token_vault_a.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_b.key(), false),
        AccountMeta::new(ctx.accounts.lp_tick_array_lower.key(), false),
        AccountMeta::new(ctx.accounts.lp_tick_array_upper.key(), false),
    ];

    let ix = Instruction {
        program_id: WHIRLPOOL_PROGRAM_ID,
        accounts,
        data,
    };

    let infos = [
        ctx.accounts.whirlpool.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.xive.to_account_info(),
        ctx.accounts.lp_position.to_account_info(),
        ctx.accounts.lp_position_token_account.to_account_info(),
        ctx.accounts.xive_xusd_ata.to_account_info(),
        ctx.accounts.xive_usdc_ata.to_account_info(),
        ctx.accounts.token_vault_a.to_account_info(),
        ctx.accounts.token_vault_b.to_account_info(),
        ctx.accounts.lp_tick_array_lower.to_account_info(),
        ctx.accounts.lp_tick_array_upper.to_account_info(),
        ctx.accounts.whirlpool_program.to_account_info(),
    ];

    invoke_signed(&ix, &infos, signer_seeds)?;
    let _ = LP_TICK_LOWER; // kept for future invariants
    let _ = LP_TICK_UPPER;
    Ok(())
}
