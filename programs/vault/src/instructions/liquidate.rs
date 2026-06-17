use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use xive::cpi::accounts::{LiquidatePosition, ReturnCollateral};
use xive::program::Xive as XiveProgram;
use xive::state::position::Position;
use xive::state::collateral::Collateral;
use crate::{Vault, Xive, XIVE_SEED, USDC_MINT_ADDRESS, XIVE_PROGRAM_ID, VaultError};
use crate::constants::{VAULT_SEED, JUPITER_PROGRAM_ID, LIQUIDATION_BONUS_PCT};

#[derive(Accounts)]
pub struct Liquidate<'info> {

    // permissionless — anyone can trigger a liquidation of an unhealthy position
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
        seeds::program = xive::ID,
    )]
    pub xive: Account<'info, Xive>,

    // validated (seeds, health) inside xive::liquidate_position
    #[account(mut)]
    pub position: Account<'info, Position>,

    pub collateral: Account<'info, Collateral>,

    #[account(
        mut,
        address = position.collateral_mint
    )]
    pub collateral_mint: Account<'info, Mint>,

    // shared xive-owned collateral pool
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = xive,
    )]
    pub xive_collateral_ata: Box<Account<'info, TokenAccount>>,

    // vault's collateral ATA — receives the seized collateral, source for the swap
    #[account(
        init_if_needed,
        payer = liquidator,
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
    )]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(address = USDC_MINT_ADDRESS)]
    pub usdc_mint: Account<'info, Mint>,

    // vault's USDC reserve — receives the swap proceeds
    #[account(
        init_if_needed,
        payer = liquidator,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: forwarded swap target; pinned to the Jupiter program id
    #[account(address = JUPITER_PROGRAM_ID)]
    pub jupiter_program: UncheckedAccount<'info>,

    pub xive_program: Program<'info, XiveProgram>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

}

// `jupiter_swap_data` is the instruction data of a client-built Jupiter route
// (collateral -> USDC) whose user transfer authority is the vault PDA; its accounts
// are passed as `remaining_accounts`. Two modes:
//   - collateral covers debt + bonus: ExactOut(debt + bonus) -> surplus returned to xive.
//   - collateral can't cover it:       ExactIn(all seized collateral) -> max USDC, vault loss.
pub fn liquidate(ctx: Context<Liquidate>, jupiter_swap_data: Vec<u8>) -> Result<()> {

    // capture the debt before liquidate_position zeroes it
    let loan_amount = ctx.accounts.position.loan_amount;
    require!(loan_amount > 0, VaultError::NothingToLiquidate);

    // USDC the swap must produce: debt + bonus%
    let required_usdc = (loan_amount as u128)
        .checked_mul((100 + LIQUIDATION_BONUS_PCT) as u128).ok_or(VaultError::MathOverflow)?
        .checked_div(100).ok_or(VaultError::MathOverflow)?;
    let required_usdc = u64::try_from(required_usdc).map_err(|_| VaultError::MathOverflow)?;

    // snapshot balances so we can measure seized/consumed via deltas
    let collateral_before = ctx.accounts.vault_collateral_ata.amount;
    let usdc_before = ctx.accounts.vault_usdc_ata.amount;

    let bump = ctx.accounts.vault.bump;
    let vault_seeds: &[&[&[u8]]] = &[&[VAULT_SEED.as_bytes(), &[bump]]];

    // 1) seize the collateral and shift the debt onto vault_balance
    xive::cpi::liquidate_position(
        CpiContext::new_with_signer(
            XIVE_PROGRAM_ID,
            LiquidatePosition {
                signer: ctx.accounts.vault.to_account_info(),
                position: ctx.accounts.position.to_account_info(),
                collateral: ctx.accounts.collateral.to_account_info(),
                collateral_mint: ctx.accounts.collateral_mint.to_account_info(),
                xive_collateral_ata: ctx.accounts.xive_collateral_ata.to_account_info(),
                vault_collateral_ata: ctx.accounts.vault_collateral_ata.to_account_info(),
                xive: ctx.accounts.xive.to_account_info(),
                associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            vault_seeds,
        ),
    )?;

    // 2) swap collateral -> USDC via Jupiter (client-built ExactOut route, vault PDA signs)
    let metas: Vec<AccountMeta> = ctx.remaining_accounts.iter().map(|a| {
        if a.is_writable {
            AccountMeta::new(*a.key, a.is_signer)
        } else {
            AccountMeta::new_readonly(*a.key, a.is_signer)
        }
    }).collect();
    let swap_ix = Instruction {
        program_id: ctx.accounts.jupiter_program.key(),
        accounts: metas,
        data: jupiter_swap_data,
    };
    invoke_signed(&swap_ix, ctx.remaining_accounts, vault_seeds)?;

    // 3) measure the swap result
    ctx.accounts.vault_usdc_ata.reload()?;
    ctx.accounts.vault_collateral_ata.reload()?;

    let usdc_gained = ctx.accounts.vault_usdc_ata.amount
        .checked_sub(usdc_before).ok_or(VaultError::MathOverflow)?;
    let unused = ctx.accounts.vault_collateral_ata.amount
        .checked_sub(collateral_before).ok_or(VaultError::MathOverflow)?;

    // Valid if EITHER debt + bonus was covered (surplus returned below) OR all the
    // seized collateral was consumed (under-water: best-effort max USDC, vault loss).
    // This still blocks a partial under-swap that neither covers nor uses everything.
    require!(usdc_gained >= required_usdc || unused == 0, VaultError::SlippageExceeded);

    // 4) return any collateral the swap didn't consume to xive (for the borrower)
    if unused > 0 {
        xive::cpi::return_collateral(
            CpiContext::new_with_signer(
                XIVE_PROGRAM_ID,
                ReturnCollateral {
                    signer: ctx.accounts.vault.to_account_info(),
                    position: ctx.accounts.position.to_account_info(),
                    collateral_mint: ctx.accounts.collateral_mint.to_account_info(),
                    xive: ctx.accounts.xive.to_account_info(),
                    xive_collateral_ata: ctx.accounts.xive_collateral_ata.to_account_info(),
                    vault_collateral_ata: ctx.accounts.vault_collateral_ata.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                vault_seeds,
            ),
            unused,
        )?;
    }

    Ok(())
}
