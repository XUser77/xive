use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Team {

    pub bump: u8,

}
