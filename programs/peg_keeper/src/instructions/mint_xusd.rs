use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::{PegKeeper, PEG_KEEPER_SEED};

#[derive(Accounts)]
pub struct MintXusd<'info> {
    #[account(
        seeds = [PEG_KEEPER_SEED.as_bytes()],
        bump = peg_keeper.bump,
        has_one = authorized_minter,
        has_one = xusd_mint,
    )]
    pub peg_keeper: Account<'info, PegKeeper>,

    pub authorized_minter: Signer<'info>,

    #[account(mut)]
    pub xusd_mint: Account<'info, Mint>,

    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<MintXusd>, amount: u64) -> Result<()> {
    let seeds = &[PEG_KEEPER_SEED.as_bytes(), &[ctx.accounts.peg_keeper.bump]];
    let signer_seeds = &[&seeds[..]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.peg_keeper.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    msg!("Minted {} XUSD", amount);
    Ok(())
}
