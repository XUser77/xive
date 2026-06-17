import {
  connection,
  payer,
  xiveProgram,
  vaultProgram,
  teamProgram,
  xivePda,
  vaultPda,
  teamPda,
  ata,
  accountExists,
  airdrop,
  XUSD_MINT,
  LP_XUSD_MINT,
  XIVE_TOKEN_MINT,
  VE_XIVE_TOKEN_MINT,
  xusdMintKp,
  lpMintKp,
  xiveTokenKp,
  veXiveTokenKp,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SystemProgram,
} from "./helpers.js";

export const LOAN_FEE_BPS = 100; // 1%

// One-shot initialize instructions; tolerate an already-initialized validator so
// the suite can be re-run without restarting surfpool.
async function ensureXive() {
  if (await accountExists(xivePda())) return;
  await xiveProgram.methods
    .initialize(LOAN_FEE_BPS)
    .accountsPartial({
      payer: payer.publicKey,
      xive: xivePda(),
      xusdMint: XUSD_MINT,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([xusdMintKp])
    .rpc();
}

async function ensureVault() {
  if (await accountExists(vaultPda())) return;
  await vaultProgram.methods
    .initialize()
    .accountsPartial({
      signer: payer.publicKey,
      vault: vaultPda(),
      lpXusdMint: LP_XUSD_MINT,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([lpMintKp])
    .rpc();
}

async function ensureTeam() {
  if (await accountExists(teamPda())) return;
  await teamProgram.methods
    .initialize()
    .accountsPartial({
      signer: payer.publicKey,
      team: teamPda(),
      xiveMint: XIVE_TOKEN_MINT,
      veXiveMint: VE_XIVE_TOKEN_MINT,
      signerXiveAta: ata(payer.publicKey, XIVE_TOKEN_MINT),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([xiveTokenKp, veXiveTokenKp])
    .rpc();
}

export const mochaHooks = {
  async beforeAll(this: any) {
    this.timeout(120000);

    // make sure the fee payer has SOL on the fork
    const bal = await connection.getBalance(payer.publicKey);
    if (bal < 50 * 1e9) {
      try {
        await airdrop(payer.publicKey, 1000);
      } catch {
        /* fork may not support airdrop to a pre-funded wallet */
      }
    }

    await ensureXive();
    await ensureVault();
    await ensureTeam();
  },
};
