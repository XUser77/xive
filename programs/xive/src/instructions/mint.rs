use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token;
use anchor_spl::token::{MintTo, Token, TokenAccount};
use crate::{Xive, XIVE_SEED, XUSD_MINT_ADDRESS, utils};
use crate::errors::XiveError;

#[derive(Accounts)]
pub struct Mint<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [XIVE_SEED.as_bytes()],
        bump = xive.bump,
    )]
    pub xive: Account<'info, Xive>,

    #[account(
        mut,
        address = XUSD_MINT_ADDRESS,
        mint::authority = xive,
    )]
    pub xusd_mint: Account<'info, token::Mint>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = xusd_mint,
        associated_token::authority = signer,
    )]
    pub signer_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,

}

pub fn mint(ctx: Context<Mint>, amount: u64) -> Result<()> {

    let vault_address = utils::get_vault_pda_address()?;
    let team_address = utils::get_team_pda_address()?;

    require!(
        [vault_address, team_address].contains(&ctx.accounts.signer.key()),
        XiveError::InvalidSigner
    );

    let xive = &mut ctx.accounts.xive;
    let val = i64::try_from(amount).map_err(|_| XiveError::MathOverflow)?;

    if team_address == ctx.accounts.signer.key() {
        require!(xive.team_balance >= val, XiveError::ExceedBalance);
        xive.team_balance = xive.team_balance.checked_sub(val).ok_or(XiveError::MathOverflow)?;
    } else if vault_address == ctx.accounts.signer.key() {
        xive.vault_balance = xive.vault_balance.checked_sub(val).ok_or(XiveError::MathOverflow)?;
    }

    let bump = xive.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        XIVE_SEED.as_bytes(),
        &[bump],
    ]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.xusd_mint.to_account_info(),
                to: ctx.accounts.signer_ata.to_account_info(),
                authority: xive.to_account_info(),
            },
            signer_seeds,
        ),
        amount
    )?;

    Ok(())
}
