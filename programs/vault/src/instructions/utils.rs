use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};
use xive::state::xive::Xive;
use crate::{ Vault, VaultError, LP_XUSD_MIN_PRICE, LP_XUSD_INITIAL_PRICE };

pub fn get_lp_xusd_price(vault: &Vault,
                         xive: &Xive,
                         usdc_ata: &Account<TokenAccount>,
                         xusd_ata: &Account<TokenAccount>,
                         lp_xusd_mint: &Account<Mint>) -> Result<u64> {
    let assets: i128 = (xusd_ata.amount as i128)
        .checked_add(usdc_ata.amount as i128).ok_or(VaultError::MathOverflow)?
        .checked_add(xive.vault_balance as i128).ok_or(VaultError::MathOverflow)?
        .checked_sub(vault.xusd_assets as i128).ok_or(VaultError::MathOverflow)?
        .checked_sub(vault.usdc_assets as i128).ok_or(VaultError::MathOverflow)?;

    if assets < 0 {
        return Ok(LP_XUSD_MIN_PRICE);
    }

    let supply = lp_xusd_mint.supply as i128;
    if supply <= 0 {
       return Ok(LP_XUSD_INITIAL_PRICE);
    }

    let price = assets
        .checked_mul(1000 * 1000).ok_or(VaultError::MathOverflow)?
        .checked_div(supply).ok_or(VaultError::MathOverflow)?;
    if price < LP_XUSD_MIN_PRICE as i128 {
        return Ok(LP_XUSD_MIN_PRICE);
    }

    Ok(u64::try_from(price).map_err(|_| VaultError::MathOverflow)?)

}