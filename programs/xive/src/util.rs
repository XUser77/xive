use collaterals::PRICE_DECIMALS;
use peg_keeper::XUSD_DECIMALS;

/// Compute max loan in XUSD base units for a given collateral position.
///
/// `price` is fixed-point USD per whole collateral, scaled by 10^PRICE_DECIMALS.
/// `collateral_amount` is in raw base units of the collateral token.
/// `ltv_bps` is in basis points (e.g. 9000 = 90%).
///
/// Real-arithmetic formula:
///   max_loan_real = (collateral_raw / 10^collateral_decimals)
///                 * (price_raw / 10^PRICE_DECIMALS)
///                 * (ltv_bps / 10_000)
///   max_loan_raw  = max_loan_real * 10^XUSD_DECIMALS
///
/// Rearranged for integer math:
///   max_loan_raw = collateral_raw * price * ltv_bps / 10_000
///                  * 10^(XUSD_DECIMALS - collateral_decimals - PRICE_DECIMALS)
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

    let net_shift: i32 = (XUSD_DECIMALS as i32)
        - (collateral_decimals as i32)
        - (PRICE_DECIMALS as i32);

    if net_shift >= 0 {
        base.checked_mul(10u128.pow(net_shift as u32)).unwrap()
    } else {
        base.checked_div(10u128.pow((-net_shift) as u32)).unwrap()
    }
}

/// Commission to charge on a borrowed XUSD amount, in base units.
///   fee = loan * commission_bps / 10_000  (rounded down)
pub fn commission_amount(loan: u64, commission_bps: u64) -> u64 {
    ((loan as u128)
        .checked_mul(commission_bps as u128)
        .unwrap()
        .checked_div(10_000)
        .unwrap()) as u64
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
