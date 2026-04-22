use peg_keeper::XUSD_DECIMALS;

/// Compute max loan in XUSD base units for a given collateral position.
///
/// `price` is treated as whole XUSD per whole collateral (the raw user-facing
/// dollar price). `ltv_bps` is in basis points (e.g. 9000 = 90%).
///
/// Formula:
///   max_loan = collateral_raw * price * ltv_bps / 10_000
///              * 10^(XUSD_DECIMALS - collateral_decimals)
pub fn max_loan_xusd(
    collateral_amount: u64,
    price: u64,
    ltv_bps: u64,
    collateral_decimals: u8,
) -> u128 {
    let base = (collateral_amount as u128)
        .checked_mul(price as u128)
        .unwrap()
        .checked_mul(ltv_bps as u128)
        .unwrap()
        .checked_div(10_000)
        .unwrap();

    if collateral_decimals >= XUSD_DECIMALS {
        let pow = 10u128.pow((collateral_decimals - XUSD_DECIMALS) as u32);
        base.checked_div(pow).unwrap()
    } else {
        let pow = 10u128.pow((XUSD_DECIMALS - collateral_decimals) as u32);
        base.checked_mul(pow).unwrap()
    }
}

/// Compute liquidation threshold (debt-in-XUSD level at which position is liquidatable).
pub fn liquidation_threshold_xusd(
    collateral_amount: u64,
    price: u64,
    liquidation_ltv_bps: u64,
    collateral_decimals: u8,
) -> u128 {
    max_loan_xusd(collateral_amount, price, liquidation_ltv_bps, collateral_decimals)
}
