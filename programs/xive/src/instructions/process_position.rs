use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token::{ Mint, MintTo, TokenAccount, TransferChecked };
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
            token_program,
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
    position.collateral_amount = collateral_amount;

    Ok(())
}

pub fn borrow_xusd<'info>(position: &mut Account<'info, Position>,
                          xive: &Account<'info, Xive>,
                          token_program: Pubkey,
                          xusd_mint: AccountInfo<'info>,
                          borrower_xusd_ata: AccountInfo<'info>,
                          loan_amount: u64,
                          collateral: &Account<'info, Collateral>,
                          collateral_decimals: u8) -> Result<()> {
    require!(loan_amount > 0, XiveError::LoanZero);
    require!(collateral.price_date + PRICE_TIMEOUT > Clock::get()?.unix_timestamp, XiveError::CollateralPriceStale);

    let new_bps = get_position_bps(loan_amount, position.collateral_amount, collateral.price, collateral_decimals)?;
    require!(new_bps <= collateral.tvl, XiveError::LTVBreached);

    position.loan_amount = loan_amount;

    // TODO: Check fee calculation
    let fee = get_fee(position.loan_amount, xive.loan_fee)?;
    let borrower_xusd = position.loan_amount.checked_sub(fee).ok_or(XiveError::MathOverflow)?;

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