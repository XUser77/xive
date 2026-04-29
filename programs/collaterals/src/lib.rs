pub mod constants;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("HmMqUcvc8WJAaFWafJNwEHGakhegGSzZeqsGcE8NCucx");

#[program]
pub mod collaterals {
    use super::*;

    pub fn update_collateral(
        ctx: Context<UpdateCollateral>,
        ltv: u64,
        liquidation_ltv: u64,
        price: u64,
        allowed: bool,
    ) -> Result<()> {
        update_collateral::handler(ctx, ltv, liquidation_ltv, price, allowed)
    }

    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> Result<()> {
        set_price::handler(ctx, price)
    }
}
