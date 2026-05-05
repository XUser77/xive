use anchor_lang::prelude::*;

declare_id!("xtm3VMkqiNhP2rd74yZUzsXFZMyAJapmcP7HUSfwD4i");

#[constant]
pub const TEAM_SEED: &str = "team";

#[account]
#[derive(InitSpace)]
pub struct Team {
    pub bump: u8,
}

#[program]
pub mod team {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.team.bump = ctx.bumps.team;
        msg!("Team treasury initialized: {}", ctx.accounts.team.key());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Team::INIT_SPACE,
        seeds = [TEAM_SEED.as_bytes()],
        bump,
    )]
    pub team: Account<'info, Team>,

    pub system_program: Program<'info, System>,
}
