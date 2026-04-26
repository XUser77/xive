use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

// sha256("global:two_hop_swap")[..8]
const TWO_HOP_SWAP_DISC: [u8; 8] = [195, 96, 237, 108, 68, 162, 219, 230];

use xive::state::Position;

use crate::error::ErrorCode;
use crate::{
    Vault, LIQUIDATION_BONUS_BPS, USDC_MINT, VAULT_SEED, WHIRLPOOL_PROGRAM_ID, XUSD_MINT,
};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    // ---------- xive accounts (for both liquidate & return_collateral CPIs) ----------
    pub xive_program: Program<'info, xive::program::Xive>,

    /// CHECK: xive singleton PDA — validated by xive CPI.
    #[account(mut)]
    pub xive_state: UncheckedAccount<'info>,

    /// CHECK: xive collateral PDA — validated by xive CPI.
    #[account(mut)]
    pub xive_collateral: UncheckedAccount<'info>,

    /// CHECK: position account — validated by xive CPI.
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    #[account(mut, address = XUSD_MINT)]
    pub xusd_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = xusd_mint,
        associated_token::authority = vault,
    )]
    pub vault_xusd_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated by xive CPI via position.collateral_mint.
    pub collateral_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: xive's collateral vault ATA — validated by xive CPI.
    #[account(mut)]
    pub xive_collateral_ata: UncheckedAccount<'info>,

    // ---------- intermediate USDC leg ----------
    #[account(address = USDC_MINT)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Box<Account<'info, TokenAccount>>,

    // ---------- Orca two_hop_swap accounts ----------
    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: pool 1 (collateral/USDC).
    #[account(mut)]
    pub whirlpool_one: UncheckedAccount<'info>,
    /// CHECK: pool 2 (USDC/XUSD).
    #[account(mut)]
    pub whirlpool_two: UncheckedAccount<'info>,

    /// CHECK: vault's ATA for pool-1 token A (matches mint order; client picks).
    #[account(mut)]
    pub token_owner_one_a: UncheckedAccount<'info>,
    /// CHECK: pool 1 token A vault.
    #[account(mut)]
    pub token_vault_one_a: UncheckedAccount<'info>,
    /// CHECK: vault's ATA for pool-1 token B.
    #[account(mut)]
    pub token_owner_one_b: UncheckedAccount<'info>,
    /// CHECK: pool 1 token B vault.
    #[account(mut)]
    pub token_vault_one_b: UncheckedAccount<'info>,

    /// CHECK: vault's ATA for pool-2 token A.
    #[account(mut)]
    pub token_owner_two_a: UncheckedAccount<'info>,
    /// CHECK: pool 2 token A vault.
    #[account(mut)]
    pub token_vault_two_a: UncheckedAccount<'info>,
    /// CHECK: vault's ATA for pool-2 token B.
    #[account(mut)]
    pub token_owner_two_b: UncheckedAccount<'info>,
    /// CHECK: pool 2 token B vault.
    #[account(mut)]
    pub token_vault_two_b: UncheckedAccount<'info>,

    /// CHECK: pool 1 tick array 0.
    #[account(mut)]
    pub tick_array_one_0: UncheckedAccount<'info>,
    /// CHECK: pool 1 tick array 1.
    #[account(mut)]
    pub tick_array_one_1: UncheckedAccount<'info>,
    /// CHECK: pool 1 tick array 2.
    #[account(mut)]
    pub tick_array_one_2: UncheckedAccount<'info>,
    /// CHECK: pool 2 tick array 0.
    #[account(mut)]
    pub tick_array_two_0: UncheckedAccount<'info>,
    /// CHECK: pool 2 tick array 1.
    #[account(mut)]
    pub tick_array_two_1: UncheckedAccount<'info>,
    /// CHECK: pool 2 tick array 2.
    #[account(mut)]
    pub tick_array_two_2: UncheckedAccount<'info>,

    /// CHECK: pool 1 oracle PDA.
    pub oracle_one: UncheckedAccount<'info>,
    /// CHECK: pool 2 oracle PDA.
    pub oracle_two: UncheckedAccount<'info>,

    // ---------- framework ----------
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Liquidate>, a_to_b_one: bool, a_to_b_two: bool) -> Result<()> {
    // Read position state *before* liquidating.
    let (debt, seized) = read_position(&ctx.accounts.position)?;
    require!(debt > 0, ErrorCode::NoDebt);
    require!(seized > 0, ErrorCode::NoCollateral);

    let target_xusd = debt
        .checked_mul(10_000u64.checked_add(LIQUIDATION_BONUS_BPS).unwrap())
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    let bump = ctx.accounts.vault.bump;
    let seeds: &[&[u8]] = &[VAULT_SEED.as_bytes(), std::slice::from_ref(&bump)];
    let signer_seeds = &[seeds];

    // --- 1. xive::liquidate → vault burns debt XUSD, receives all collateral ---
    xive::cpi::liquidate(CpiContext::new_with_signer(
        ctx.accounts.xive_program.to_account_info().key(),
        xive::cpi::accounts::Liquidate {
            caller: ctx.accounts.vault.to_account_info(),
            xive: ctx.accounts.xive_state.to_account_info(),
            collateral: ctx.accounts.xive_collateral.to_account_info(),
            position: ctx.accounts.position.to_account_info(),
            xusd_mint: ctx.accounts.xusd_mint.to_account_info(),
            caller_xusd_ata: ctx.accounts.vault_xusd_ata.to_account_info(),
            collateral_mint: ctx.accounts.collateral_mint.to_account_info(),
            caller_collateral_ata: ctx.accounts.vault_collateral_ata.to_account_info(),
            vault_collateral_ata: ctx.accounts.xive_collateral_ata.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        signer_seeds,
    ))?;

    ctx.accounts.vault_collateral_ata.reload()?;
    let collateral_before_swap = ctx.accounts.vault_collateral_ata.amount;

    // --- 2. Orca two_hop_swap: exact-output target_xusd, max input = seized collateral ---
    two_hop_swap_exact_out(&ctx, target_xusd, seized, a_to_b_one, a_to_b_two, signer_seeds)?;

    ctx.accounts.vault_collateral_ata.reload()?;
    let collateral_after_swap = ctx.accounts.vault_collateral_ata.amount;
    let consumed = collateral_before_swap
        .checked_sub(collateral_after_swap)
        .ok_or(ErrorCode::SwapOverConsumed)?;
    let refund = seized.checked_sub(consumed).ok_or(ErrorCode::SwapOverConsumed)?;

    // --- 3. xive::return_collateral → put the unused collateral back into the position ---
    if refund > 0 {
        xive::cpi::return_collateral(
            CpiContext::new_with_signer(
                ctx.accounts.xive_program.to_account_info().key(),
                xive::cpi::accounts::ReturnCollateral {
                    caller: ctx.accounts.vault.to_account_info(),
                    xive: ctx.accounts.xive_state.to_account_info(),
                    position: ctx.accounts.position.to_account_info(),
                    collateral_mint: ctx.accounts.collateral_mint.to_account_info(),
                    caller_collateral_ata: ctx.accounts.vault_collateral_ata.to_account_info(),
                    vault_collateral_ata: ctx.accounts.xive_collateral_ata.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                signer_seeds,
            ),
            refund,
        )?;
    }

    msg!(
        "Liquidated: debt={} target_xusd={} seized={} consumed={} refund={}",
        debt,
        target_xusd,
        seized,
        consumed,
        refund
    );
    Ok(())
}

fn read_position(position: &UncheckedAccount) -> Result<(u64, u64)> {
    let data = position.try_borrow_data()?;
    let pos = Position::try_deserialize(&mut &data[..])?;
    Ok((pos.loan_amount, pos.collateral_amount))
}

fn two_hop_swap_exact_out<'info>(
    ctx: &Context<Liquidate<'info>>,
    target_out: u64,
    max_in: u64,
    a_to_b_one: bool,
    a_to_b_two: bool,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Args: amount(u64) | other_amount_threshold(u64) | amount_specified_is_input(bool)
    //       | a_to_b_one(bool) | a_to_b_two(bool)
    //       | sqrt_price_limit_one(u128) | sqrt_price_limit_two(u128)
    let mut data = Vec::with_capacity(8 + 8 + 8 + 3 + 16 + 16);
    data.extend_from_slice(&TWO_HOP_SWAP_DISC);
    data.extend_from_slice(&target_out.to_le_bytes());
    data.extend_from_slice(&max_in.to_le_bytes());
    data.push(0); // amount_specified_is_input = false (exact output)
    data.push(a_to_b_one as u8);
    data.push(a_to_b_two as u8);
    data.extend_from_slice(&0u128.to_le_bytes());
    data.extend_from_slice(&0u128.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
        AccountMeta::new(ctx.accounts.whirlpool_one.key(), false),
        AccountMeta::new(ctx.accounts.whirlpool_two.key(), false),
        AccountMeta::new(ctx.accounts.token_owner_one_a.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_one_a.key(), false),
        AccountMeta::new(ctx.accounts.token_owner_one_b.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_one_b.key(), false),
        AccountMeta::new(ctx.accounts.token_owner_two_a.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_two_a.key(), false),
        AccountMeta::new(ctx.accounts.token_owner_two_b.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_two_b.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_one_0.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_one_1.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_one_2.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_two_0.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_two_1.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_two_2.key(), false),
        AccountMeta::new_readonly(ctx.accounts.oracle_one.key(), false),
        AccountMeta::new_readonly(ctx.accounts.oracle_two.key(), false),
    ];

    let ix = Instruction {
        program_id: WHIRLPOOL_PROGRAM_ID,
        accounts,
        data,
    };

    let infos = [
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.whirlpool_one.to_account_info(),
        ctx.accounts.whirlpool_two.to_account_info(),
        ctx.accounts.token_owner_one_a.to_account_info(),
        ctx.accounts.token_vault_one_a.to_account_info(),
        ctx.accounts.token_owner_one_b.to_account_info(),
        ctx.accounts.token_vault_one_b.to_account_info(),
        ctx.accounts.token_owner_two_a.to_account_info(),
        ctx.accounts.token_vault_two_a.to_account_info(),
        ctx.accounts.token_owner_two_b.to_account_info(),
        ctx.accounts.token_vault_two_b.to_account_info(),
        ctx.accounts.tick_array_one_0.to_account_info(),
        ctx.accounts.tick_array_one_1.to_account_info(),
        ctx.accounts.tick_array_one_2.to_account_info(),
        ctx.accounts.tick_array_two_0.to_account_info(),
        ctx.accounts.tick_array_two_1.to_account_info(),
        ctx.accounts.tick_array_two_2.to_account_info(),
        ctx.accounts.oracle_one.to_account_info(),
        ctx.accounts.oracle_two.to_account_info(),
        ctx.accounts.whirlpool_program.to_account_info(),
    ];

    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}
