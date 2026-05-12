use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::{
    Fees, FEES_SEED, TEAM_FEE_SHARE_BPS, TEAM_PROGRAM_ID, TEAM_SEED, USDC_MINT,
    WHIRLPOOL_PROGRAM_ID, XUSD_MINT,
};

/// sqrt_price(tick) * 2^64 for our hardcoded ±100-tick LP range, matching Orca's
/// `tickIndexToSqrtPriceX64`. Must stay in sync with `LP_TICK_LOWER` / `LP_TICK_UPPER`
/// in `init_lp_position.rs`.
const SQRT_PRICE_LOWER_Q64: u128 = 18_354_745_142_194_483_561; // tick -100
const SQRT_PRICE_UPPER_Q64: u128 = 18_539_204_128_674_405_812; // tick +100

/// Byte offset of `sqrt_price` inside a Whirlpool account:
///   8 (disc) + 32 (config) + 1 (bump) + 2 (tick_spacing) + 2 (fee_tier_index_seed)
///   + 2 (fee_rate) + 2 (protocol_fee_rate) + 16 (liquidity) = 65
const WHIRLPOOL_SQRT_PRICE_OFFSET: usize = 65;

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
        seeds = [FEES_SEED.as_bytes()],
        bump = fees.bump,
        constraint = fees.lp_position_mint != Pubkey::default() @ ErrorCode::LpPositionNotInitialized,
    )]
    pub fees: Box<Account<'info, Fees>>,

    #[account(address = XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,
    #[account(address = USDC_MINT)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// fees-owned XUSD ATA — borrow commissions accumulate here.
    #[account(
        mut,
        associated_token::mint = xusd_mint,
        associated_token::authority = fees,
    )]
    pub fees_xusd_ata: Box<Account<'info, TokenAccount>>,

    /// fees-owned USDC ATA — receives the swap output and is consumed by increase_liquidity.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = fees,
    )]
    pub fees_usdc_ata: Box<Account<'info, TokenAccount>>,

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
    /// CHECK: validated against fees.lp_whirlpool.
    #[account(mut, address = fees.lp_whirlpool @ ErrorCode::WhirlpoolMismatch)]
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
    /// CHECK: fees' existing LP position PDA — validated against fees.lp_position_mint via the
    ///   token account's mint, and via Orca's own seeds checks.
    #[account(mut)]
    pub lp_position: UncheckedAccount<'info>,

    /// CHECK: position NFT mint stored in fees state.
    #[account(address = fees.lp_position_mint @ ErrorCode::PositionMintMismatch)]
    pub lp_position_mint: UncheckedAccount<'info>,

    /// fees' ATA holding the LP position NFT.
    #[account(
        associated_token::mint = lp_position_mint,
        associated_token::authority = fees,
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
    let total = ctx.accounts.fees_xusd_ata.amount;
    require!(total > 0, ErrorCode::NoFees);

    // Split: 80% to team, 20% to LP. LP slice is half-swapped to USDC, then both sides
    // go into the LP position. Rounding always rounds the team share down.
    let team_amount = ((total as u128) * (TEAM_FEE_SHARE_BPS as u128) / 10_000) as u64;
    let lp_amount = total.checked_sub(team_amount).unwrap();
    let swap_amount = lp_amount / 2;
    let lp_xusd_amount = lp_amount.checked_sub(swap_amount).unwrap();

    let bump = ctx.accounts.fees.bump;
    let seeds = &[FEES_SEED.as_bytes(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    // 1) Transfer 80% to the team treasury ATA.
    if team_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.fees_xusd_ata.to_account_info(),
                    to: ctx.accounts.team_xusd_ata.to_account_info(),
                    authority: ctx.accounts.fees.to_account_info(),
                },
                signer_seeds,
            ),
            team_amount,
        )?;
    }

    // 2) Swap half of the LP slice XUSD → USDC. Pool ordering (mintA = XUSD, mintB = USDC)
    //    is enforced at pool init time, so swap is A→B, aToB=true.
    if swap_amount > 0 {
        swap_xusd_to_usdc(&ctx, swap_amount, signer_seeds)?;
    }

    ctx.accounts.fees_usdc_ata.reload()?;
    let usdc_in = ctx.accounts.fees_usdc_ata.amount;

    // 3) Increase liquidity on the LP position with (lp_xusd_amount, usdc_in).
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
    let mut data = Vec::with_capacity(8 + 8 + 8 + 16 + 1 + 1);
    data.extend_from_slice(&SWAP_DISC);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // min out = 0
    // sqrt_price_limit = MIN_SQRT_PRICE for aToB=true
    data.extend_from_slice(&4_295_048_016u128.to_le_bytes());
    data.push(1); // amount_specified_is_input = true
    data.push(1); // a_to_b = true (XUSD = mintA → USDC = mintB)

    let accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.fees.key(), true), // token_authority
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new(ctx.accounts.fees_xusd_ata.key(), false), // owner A
        AccountMeta::new(ctx.accounts.token_vault_a.key(), false),
        AccountMeta::new(ctx.accounts.fees_usdc_ata.key(), false), // owner B
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
        ctx.accounts.fees.to_account_info(),
        ctx.accounts.whirlpool.to_account_info(),
        ctx.accounts.fees_xusd_ata.to_account_info(),
        ctx.accounts.token_vault_a.to_account_info(),
        ctx.accounts.fees_usdc_ata.to_account_info(),
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
    // Read live sqrt_price from the pool. Orca's deposit math is:
    //   amount_a = ceil(L * 2^64 * (sqrt_u - sqrt_p) / (sqrt_p * sqrt_u))
    //   amount_b = ceil(L * (sqrt_p - sqrt_l) / 2^64)
    // We invert each side to get the max L that keeps amount ≤ max, then take the min.
    let sqrt_p: u128 = {
        let data = ctx.accounts.whirlpool.try_borrow_data()?;
        let bytes: [u8; 16] = data[WHIRLPOOL_SQRT_PRICE_OFFSET..WHIRLPOOL_SQRT_PRICE_OFFSET + 16]
            .try_into()
            .unwrap();
        u128::from_le_bytes(bytes)
    };

    require!(
        sqrt_p > SQRT_PRICE_LOWER_Q64 && sqrt_p < SQRT_PRICE_UPPER_Q64,
        ErrorCode::PoolOutOfRange,
    );

    // L_a = floor(max_a * sqrt_p * sqrt_u / (2^64 * (sqrt_u - sqrt_p)))
    // sqrt_p and sqrt_u are each ~2^64, so their product overflows u128. Shift each
    // down by 32 first: the 2^64 in the denominator cancels the two >>32 shifts.
    let l_from_a: u128 = {
        let denom = SQRT_PRICE_UPPER_Q64 - sqrt_p;
        let prod_shifted = (sqrt_p >> 32) * (SQRT_PRICE_UPPER_Q64 >> 32);
        (max_xusd as u128).checked_mul(prod_shifted).unwrap() / denom
    };

    // L_b = floor(max_b * 2^64 / (sqrt_p - sqrt_l))
    let l_from_b: u128 = {
        let denom = sqrt_p - SQRT_PRICE_LOWER_Q64;
        ((max_usdc as u128) << 64) / denom
    };

    let liquidity_estimate = l_from_a.min(l_from_b);
    if liquidity_estimate == 0 {
        return Ok(());
    }

    let mut data = Vec::with_capacity(8 + 16 + 8 + 8);
    data.extend_from_slice(&INCREASE_LIQUIDITY_DISC);
    data.extend_from_slice(&liquidity_estimate.to_le_bytes());
    data.extend_from_slice(&max_xusd.to_le_bytes());
    data.extend_from_slice(&max_usdc.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.fees.key(), true), // position_authority
        AccountMeta::new(ctx.accounts.lp_position.key(), false),
        AccountMeta::new_readonly(ctx.accounts.lp_position_token_account.key(), false),
        AccountMeta::new(ctx.accounts.fees_xusd_ata.key(), false), // owner A
        AccountMeta::new(ctx.accounts.fees_usdc_ata.key(), false), // owner B
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
        ctx.accounts.fees.to_account_info(),
        ctx.accounts.lp_position.to_account_info(),
        ctx.accounts.lp_position_token_account.to_account_info(),
        ctx.accounts.fees_xusd_ata.to_account_info(),
        ctx.accounts.fees_usdc_ata.to_account_info(),
        ctx.accounts.token_vault_a.to_account_info(),
        ctx.accounts.token_vault_b.to_account_info(),
        ctx.accounts.lp_tick_array_lower.to_account_info(),
        ctx.accounts.lp_tick_array_upper.to_account_info(),
    ];

    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}
