use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token::{Burn, Mint, MintTo, TransferChecked};
use crate::{ Position };
use crate::constants::{ PRICE_TIMEOUT, XIVE_SEED };
use crate::errors::XiveError;
use crate::state::collateral::Collateral;
use crate::state::xive::Xive;
use crate::utils::{ get_fee, get_position_bps };

pub fn deposit_collateral<'info>(position: &mut Account<Position>,
                                 token_program: Pubkey,
                                 borrower_collateral_ata: AccountInfo<'info>,
                                 program_collateral_ata: AccountInfo<'info>,
                                 collateral_mint: &Account<'info, Mint>,
                                 borrower: AccountInfo<'info>,
                                 collateral_amount: u64) -> Result<()> {
    require!(collateral_amount > 0, XiveError::CollateralZero);

    token::transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked {
                from: borrower_collateral_ata,
                to: program_collateral_ata,
                mint: collateral_mint.to_account_info(),
                authority: borrower,
            },
        ),
        collateral_amount,
        collateral_mint.decimals,
    )?;
    position.collateral_amount = position.collateral_amount
        .checked_add(collateral_amount)
        .ok_or(XiveError::MathOverflow)?;

    Ok(())
}

pub fn withdraw_collateral<'info>(position: &mut Account<'info, Position>,
                                  xive: &Account<'info, Xive>,
                                  token_program: Pubkey,
                                  borrower_collateral_ata: AccountInfo<'info>,
                                  program_collateral_ata: AccountInfo<'info>,
                                  collateral_mint: &Account<'info, Mint>,
                                  collateral: &Account<'info, Collateral>,
                                  collateral_amount: u64) -> Result<()> {
    require!(collateral_amount <= position.collateral_amount, XiveError::InsufficientCollateral);
    require!(collateral_amount > 0, XiveError::CollateralZero);

    let now = Clock::get()?.unix_timestamp;
    require!(
      now.checked_sub(collateral.price_date).ok_or(XiveError::MathOverflow)? <= PRICE_TIMEOUT,
      XiveError::CollateralPriceStale
    );

    let total_collateral = position.collateral_amount
        .checked_sub(collateral_amount)
        .ok_or(XiveError::MathOverflow)?;

    let new_bps = get_position_bps(position.loan_amount, total_collateral, collateral.price, collateral_mint.decimals)?;
    require!(new_bps <= collateral.ltv, XiveError::LTVBreached);

    position.collateral_amount = total_collateral;

    let bump = xive.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        XIVE_SEED.as_bytes(),
        &[bump],
    ]];

    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: program_collateral_ata,
                to: borrower_collateral_ata,
                mint: collateral_mint.to_account_info(),
                authority: xive.to_account_info(),
            },
            signer_seeds,
        ),
        collateral_amount,
        collateral_mint.decimals,
    )?;

    Ok(())
}

pub fn borrow_xusd<'info>(position: &mut Account<'info, Position>,
                          xive: &mut Account<'info, Xive>,
                          token_program: Pubkey,
                          xusd_mint: AccountInfo<'info>,
                          borrower_xusd_ata: AccountInfo<'info>,
                          program_xusd_ata: AccountInfo<'info>,
                          loan_amount: u64,
                          collateral: &Account<'info, Collateral>,
                          collateral_mint: &Account<'info, Mint>) -> Result<()> {
    require!(loan_amount > 0, XiveError::LoanZero);

    let now = Clock::get()?.unix_timestamp;
    require!(
      now.checked_sub(collateral.price_date).ok_or(XiveError::MathOverflow)? <= PRICE_TIMEOUT,
      XiveError::CollateralPriceStale
    );

    let total_loan = position.loan_amount
        .checked_add(loan_amount)
        .ok_or(XiveError::MathOverflow)?;
    let new_bps = get_position_bps(total_loan, position.collateral_amount, collateral.price, collateral_mint.decimals)?;
    require!(new_bps <= collateral.ltv, XiveError::LTVBreached);

    position.loan_amount = total_loan;

    // TODO: Check fee calculation
    let fee = get_fee(loan_amount, xive.loan_fee)?;
    let borrower_xusd = loan_amount.checked_sub(fee).ok_or(XiveError::MathOverflow)?;

    let bump = xive.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        XIVE_SEED.as_bytes(),
        &[bump],
    ]];
    // The debt (`loan_amount`) is the full face value, but the borrower only
    // receives `loan_amount - fee`. Mint the borrower's share to them and the
    // `fee` share into the program's own xUSD account, so total xUSD supply
    // always equals total outstanding debt — otherwise a later burn of the full
    // debt would underflow the mint supply. The fee tokens held here are
    // transient: they're burned again when the loan is repaid (return_xusd),
    // while the vault/team i64 balances below are the realized fee revenue.
    token::mint_to(
        CpiContext::new_with_signer(
            token_program.key(),
            MintTo {
                mint: xusd_mint.clone(),
                to: borrower_xusd_ata,
                authority: xive.to_account_info(),
            },
            signer_seeds
        ),
        borrower_xusd
    )?;

    if fee > 0 {
        token::mint_to(
            CpiContext::new_with_signer(
                token_program.key(),
                MintTo {
                    mint: xusd_mint,
                    to: program_xusd_ata,
                    authority: xive.to_account_info(),
                },
                signer_seeds
            ),
            fee
        )?;
    }

    let vault_fee = fee.checked_div(5).ok_or(XiveError::MathOverflow)?;
    let team_fee = fee.checked_sub(vault_fee).ok_or(XiveError::MathOverflow)?;

    let vault_fee = i64::try_from(vault_fee).map_err(|_| XiveError::MathOverflow)?;
    let team_fee = i64::try_from(team_fee).map_err(|_| XiveError::MathOverflow)?;

    xive.vault_balance = xive.vault_balance.checked_add(vault_fee).ok_or(XiveError::MathOverflow)?;
    xive.team_balance = xive.team_balance.checked_add(team_fee).ok_or(XiveError::MathOverflow)?;

    Ok(())
}

pub fn return_xusd<'info>(position: &mut Account<'info, Position>,
                          xive: &Account<'info, Xive>,
                          token_program: Pubkey,
                          xusd_mint: AccountInfo<'info>,
                          borrower_xusd_ata: AccountInfo<'info>,
                          program_xusd_ata: AccountInfo<'info>,
                          borrower: AccountInfo<'info>,
                          borrower_balance: u64,
                          xusd_amount: u64) -> Result<()> {
    require!(xusd_amount <= position.loan_amount, XiveError::TooMuchReturn);
    require!(xusd_amount > 0, XiveError::LoanZero);

    // The debt includes the origination fee, which was minted to the program's
    // xUSD account (not the borrower) at borrow time. Burn what the borrower can
    // cover from their own balance, and burn the remaining fee portion from the
    // program account. Together this removes exactly `xusd_amount` from supply,
    // keeping supply == total debt.
    let from_borrower = core::cmp::min(xusd_amount, borrower_balance);
    let from_program = xusd_amount.checked_sub(from_borrower).ok_or(XiveError::MathOverflow)?;

    if from_borrower > 0 {
        token::burn(
            CpiContext::new(
                token_program,
                Burn {
                    from: borrower_xusd_ata,
                    mint: xusd_mint.clone(),
                    authority: borrower,
                }
            ),
            from_borrower,
        )?;
    }

    if from_program > 0 {
        let bump = xive.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            XIVE_SEED.as_bytes(),
            &[bump],
        ]];
        token::burn(
            CpiContext::new_with_signer(
                token_program,
                Burn {
                    from: program_xusd_ata,
                    mint: xusd_mint,
                    authority: xive.to_account_info(),
                },
                signer_seeds,
            ),
            from_program,
        )?;
    }

    position.loan_amount -= xusd_amount;

    Ok(())
}