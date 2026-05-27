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
                                  borrower: AccountInfo<'info>,
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
                          xive: &Account<'info, Xive>,
                          token_program: Pubkey,
                          xusd_mint: AccountInfo<'info>,
                          borrower_xusd_ata: AccountInfo<'info>,
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
    token::mint_to(
        CpiContext::new_with_signer(
            token_program.key(),
            MintTo {
                mint: xusd_mint,
                to: borrower_xusd_ata,
                authority: xive.to_account_info(),
            },
            signer_seeds
        ),
        borrower_xusd
    )?;

    // TODO: Mint fee

    Ok(())
}

pub fn return_xusd<'info>(position: &mut Account<'info, Position>,
                          token_program: Pubkey,
                          xusd_mint: AccountInfo<'info>,
                          borrower_xusd_ata: AccountInfo<'info>,
                          borrower: AccountInfo<'info>,
                          xusd_amount: u64) -> Result<()> {
    require!(xusd_amount <= position.loan_amount, XiveError::TooMuchReturn);
    require!(xusd_amount > 0, XiveError::LoanZero);

    token::burn(
        CpiContext::new(
            token_program,
            Burn {
                from: borrower_xusd_ata,
                mint: xusd_mint,
                authority: borrower,
            }
        ),
        xusd_amount,
    )?;

    position.loan_amount -= xusd_amount;

    Ok(())
}