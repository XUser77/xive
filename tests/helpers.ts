import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor;
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
  transferChecked,
} from "@solana/spl-token";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, "..");

// ------------------------------------------------------------------ provider

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
export const connection = provider.connection;
export const wallet = provider.wallet as anchor.Wallet;
export const payer: Keypair = (wallet as any).payer;

// ------------------------------------------------------------------ programs

import type { Xive } from "../target/types/xive.js";
import type { Vault } from "../target/types/vault.js";
import type { Team } from "../target/types/team.js";

function loadIdl(name: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "target", "idl", `${name}.json`), "utf8"),
  );
}

export const xiveProgram = new anchor.Program<Xive>(loadIdl("xive"), provider);
export const vaultProgram = new anchor.Program<Vault>(loadIdl("vault"), provider);
export const teamProgram = new anchor.Program<Team>(loadIdl("team"), provider);

export const XIVE_PROGRAM_ID = xiveProgram.programId;
export const VAULT_PROGRAM_ID = vaultProgram.programId;
export const TEAM_PROGRAM_ID = teamProgram.programId;

// ------------------------------------------------------------------ constants

export const XUSD_MINT = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const LP_XUSD_MINT = new PublicKey("xLPy37ThnjtANeeiqR9N2YmjK4q7T8zFNfQteFZ5PCm");
export const XIVE_TOKEN_MINT = new PublicKey("xtxv4YGRjLXEZSGJcpi4wiCcJAv4AYcES7C35mHZFn3");
export const VE_XIVE_TOKEN_MINT = new PublicKey("xvepigF8qv1N2WdCmsQ6oht8owBjMDRV86uYvwprqo3");
export const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };

// ------------------------------------------------------------------ keypairs

export function loadKeypair(file: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(path.join(ROOT, "keys", file), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// fixed mint keypairs that the initialize instructions create at known addresses
export const xusdMintKp = loadKeypair("xusd-mint-keypair.json");
export const lpMintKp = loadKeypair("vault-mint-keypair.json");
export const xiveTokenKp = loadKeypair("xive-token.json");
export const veXiveTokenKp = loadKeypair("ve-xive-token.json");

// ------------------------------------------------------------------ PDAs

const enc = (s: string) => Buffer.from(s);

export const xivePda = () =>
  PublicKey.findProgramAddressSync([enc("xive")], XIVE_PROGRAM_ID)[0];

export const walletPda = (borrower: PublicKey) =>
  PublicKey.findProgramAddressSync([enc("wallet"), borrower.toBuffer()], XIVE_PROGRAM_ID)[0];

export const positionPda = (borrower: PublicKey, index: bigint | number) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(index));
  return PublicKey.findProgramAddressSync(
    [enc("pos"), borrower.toBuffer(), buf],
    XIVE_PROGRAM_ID,
  )[0];
};

export const collateralPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([enc("collateral"), mint.toBuffer()], XIVE_PROGRAM_ID)[0];

export const vaultPda = () =>
  PublicKey.findProgramAddressSync([enc("vault")], VAULT_PROGRAM_ID)[0];

export const teamPda = () =>
  PublicKey.findProgramAddressSync([enc("team")], TEAM_PROGRAM_ID)[0];

export const stakePda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([enc("stake"), owner.toBuffer()], TEAM_PROGRAM_ID)[0];

export const ata = (owner: PublicKey, mint: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, true);

// ------------------------------------------------------------------ utils

export const bn = (n: bigint | number) => new BN(n.toString());
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function airdrop(to: PublicKey, sol = 100) {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

export async function newFundedKeypair(sol = 100): Promise<Keypair> {
  const kp = Keypair.generate();
  await airdrop(kp.publicKey, sol);
  return kp;
}

// fresh test-controlled collateral mint (we keep mint authority)
export async function createTestMint(decimals = 6, authority = payer): Promise<PublicKey> {
  return await createMint(connection, payer, authority.publicKey, null, decimals);
}

export async function mintTokens(
  mint: PublicKey,
  to: PublicKey,
  amount: bigint | number,
  mintAuthority = payer,
) {
  const dest = await getOrCreateAssociatedTokenAccount(connection, payer, mint, to, true);
  await mintTo(connection, payer, mint, dest.address, mintAuthority, BigInt(amount.toString()));
  return dest.address;
}

export async function ensureAta(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const acc = await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner, true);
  return acc.address;
}

export async function tokenBalance(account: PublicKey): Promise<bigint> {
  try {
    const acc = await getAccount(connection, account);
    return acc.amount;
  } catch {
    return 0n;
  }
}

export async function ataBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  return tokenBalance(ata(owner, mint));
}

export async function accountExists(pubkey: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(pubkey)) !== null;
}

// Surfpool cheatcode: set a token account balance (used to fund USDC on the fork).
// Falls back gracefully so non-surfpool validators just skip it.
export async function setTokenBalance(owner: PublicKey, mint: PublicKey, amount: bigint) {
  const tokenAccount = ata(owner, mint);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`setTokenBalance amount ${amount} exceeds JS safe-integer range`);
  }
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "surfnet_setTokenAccount",
    params: [
      owner.toBase58(),
      mint.toBase58(),
      { amount: Number(amount) }, // surfpool expects a u64 number, not a string
    ],
  };
  const res = await fetch((connection as any)._rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`surfnet_setTokenAccount failed: ${JSON.stringify(json.error)}`);
  }
  return tokenAccount;
}

// ------------------------------------------------------------------ xUSD faucet
// xUSD only exists by borrowing, so the vault/team suites get it from a single
// large payer-owned position set up lazily here.

export const XUSD_DECIMALS = 6;
let _faucetMint: PublicKey | null = null;

export async function ensureXusdFaucet(): Promise<PublicKey> {
  if (_faucetMint) return _faucetMint;

  const mint = await createTestMint(6);

  await xiveProgram.methods
    .updateCollateral(true, 9000, 9500)
    .accountsPartial({
      authority: payer.publicKey,
      mint,
      collateral: collateralPda(mint),
      xive: xivePda(),
      programCollateralAta: ata(xivePda(), mint),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  await xiveProgram.methods
    .setCollateralPrice(bn(1_000_000))
    .accountsPartial({
      authority: payer.publicKey,
      mint,
      collateral: collateralPda(mint),
    })
    .rpc();

  if (!(await accountExists(walletPda(payer.publicKey)))) {
    await xiveProgram.methods
      .initWallet()
      .accountsPartial({
        borrower: payer.publicKey,
        wallet: walletPda(payer.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  const w = await xiveProgram.account.wallet.fetch(walletPda(payer.publicKey));
  const index = BigInt(w.index.toString());

  const collateral = 100_000_000 * 1_000_000; // 100M tokens
  const loan = 10_000_000 * 1_000_000; // 10M xUSD
  await mintTokens(mint, payer.publicKey, collateral);

  await xiveProgram.methods
    .openPosition(bn(collateral), bn(loan))
    .accountsPartial({
      borrower: payer.publicKey,
      wallet: walletPda(payer.publicKey),
      position: positionPda(payer.publicKey, index),
      collateralMint: mint,
      borrowerXusdAta: ata(payer.publicKey, XUSD_MINT),
      borrowerCollateralAta: ata(payer.publicKey, mint),
      programCollateralAta: ata(xivePda(), mint),
      collateral: collateralPda(mint),
      xusdMint: XUSD_MINT,
      xive: xivePda(),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  _faucetMint = mint;
  return mint;
}

export async function giveXusd(to: PublicKey, amount: bigint | number) {
  await ensureXusdFaucet();
  const dest = await getOrCreateAssociatedTokenAccount(connection, payer, XUSD_MINT, to, true);
  await transferChecked(
    connection,
    payer,
    ata(payer.publicKey, XUSD_MINT),
    XUSD_MINT,
    dest.address,
    payer,
    BigInt(amount.toString()),
    XUSD_DECIMALS,
  );
}

// Surfpool cheatcode: overwrite an account's raw bytes (used to reset singleton state
// between runs without restarting the fork).
export async function setAccountData(
  pubkey: PublicKey,
  dataHex: string,
  owner: PublicKey,
  lamports: number,
) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "surfnet_setAccount",
    params: [pubkey.toBase58(), { lamports, owner: owner.toBase58(), data: dataHex }],
  };
  const res = await fetch((connection as any)._rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(`surfnet_setAccount failed: ${JSON.stringify(json.error)}`);
}

// Zero the Team singleton's mutable counters (acc_xusd_per_share, total_staked,
// undistributed) while keeping its 8-byte discriminator + bump, so the team suite
// starts from a known baseline even on a long-lived surfpool instance.
// Layout: [8 disc][1 bump][16 acc u128][8 total_staked][8 undistributed]
export async function resetTeamCounters() {
  const pda = teamPda();
  const info = await connection.getAccountInfo(pda);
  if (!info) return; // not initialized yet
  const data = Buffer.from(info.data);
  data.fill(0, 9); // zero everything after the discriminator (8) + bump (1)
  await setAccountData(pda, data.toString("hex"), info.owner, info.lamports);
}

export { SystemProgram, PublicKey, Keypair, BN };
