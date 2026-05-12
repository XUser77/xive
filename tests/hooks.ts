/**
 * Mocha Root Hooks — runs once before the entire test suite.
 *
 * The global `beforeAll` funds the deploy/test wallets, builds, and deploys
 * only the programs whose `.so` hash has changed since the last deploy (see
 * `deployChangedPrograms`). Surfpool state is *not* reset here — instead,
 * each test file's `before` calls the exported `setupProtocol()` helper to
 * purge protocol PDAs/ATAs and re-init singletons. Skipping the global reset
 * is what makes the deploy-skip meaningful: on re-runs without code changes,
 * the deployed programs and Orca pool persist and the bootstrap is a no-op
 * past the RPC ping.
 */
import { spawnSync } from "child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG,
  PDAUtil,
  PriceMath,
  PoolUtil,
} from "@orca-so/whirlpools-sdk";
import Decimal from "decimal.js";
import type { Collaterals } from "../target/types/collaterals.ts";
import type { Fees } from "../target/types/fees.ts";
import type { PegKeeper } from "../target/types/peg_keeper.ts";
import type { Xive } from "../target/types/xive.ts";
import type { Vault } from "../target/types/vault.js";
import {
  PROJECT_ROOT,
  RPC_URL,
  pubKey,
  rpcCall,
  isRpcUp,
  poll,
  getKeyPair,
  purgeProgramAccounts,
} from "./utils.js";

const DEPLOY_WALLET = path.join(PROJECT_ROOT, "keys/deploy-wallet.json");
const TEST_WALLET = path.join(PROJECT_ROOT, "keys/test-wallet.json");

/// Multiplier converting a whole-USD figure into the on-chain `price`
/// field's 6-decimal representation. Mirrors `PRICE_DECIMALS` in
/// `programs/collaterals/src/constants.rs`.
export const PRICE_SCALE = 1_000_000;

export const COLLATERALS = {
  WETH: {
    mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    tvl: 9000, // 90%
    liqTvl: 9500, // 95%
    price: 3000 * PRICE_SCALE, // $3000.00
  },
  WBTC: {
    mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    tvl: 9000, // 90%
    liqTvl: 9500, // 95%
    price: 70_000 * PRICE_SCALE, // $70000.00
  },
};

const PROGRAMS: { name: string; so: string; keypair: string }[] = [
  { name: "team",        so: "target/deploy/team.so",        keypair: "keys/team-program.json" },
  { name: "fees",        so: "target/deploy/fees.so",        keypair: "keys/fees-program.json" },
  { name: "collaterals", so: "target/deploy/collaterals.so", keypair: "keys/collaterals-program.json" },
  { name: "peg_keeper",  so: "target/deploy/peg_keeper.so",  keypair: "keys/peg-keeper-program.json" },
  { name: "vault",       so: "target/deploy/vault.so",       keypair: "keys/vault-program.json" },
  { name: "xive",        so: "target/deploy/xive.so",        keypair: "keys/xive-program.json" },
];

const XUSD_MINT_KEY_PAIR = "keys/xusd-mint-keypair.json";
const VAULT_LP_MINT_KEY_PAIR = "keys/vault-mint-keypair.json";

/// One file per program — `target/deployed-program-hashes/<name>.sha256`
/// holds the SHA256 of the `.so` we last deployed for that program. Per-file
/// (vs one combined JSON) means a partial deploy failure still records the
/// programs that succeeded, so the next run resumes at the failed one.
const DEPLOY_HASHES_DIR = path.join(PROJECT_ROOT, "target", "deployed-program-hashes");

// Mainnet USDC — cloned by surfpool on first access.
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
// Orca 0.01% / tick_spacing=1 fee tier — standard stable config.
const STABLE_TICK_SPACING = 1;
const XUSD_DECIMALS = 6;
const USDC_DECIMALS = 6;

function log(line: string, ...args: any[]) {
  if (args.length == 0) {
    console.log(`  [hooks] ${line}`);
  } else {
    console.log(`  [hooks] ${line}`, args);
  }
}

async function fundWallet(keyPair: Keypair, walletName: string) {
  log(`Funding wallet ${keyPair.publicKey.toBase58()} (${walletName})...`);
  await rpcCall("surfnet_setAccount", [
    keyPair.publicKey,
    { lamports: 100_000_000_000 }, // 100 SOL
  ]);
}

function buildPrograms(): void {
  console.log(`  [hooks] Building programs...`);
  const result = spawnSync("anchor", ["build"], {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Build failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashFileFor(programName: string): string {
  return path.join(DEPLOY_HASHES_DIR, `${programName}.sha256`);
}

function loadProgramHash(programName: string): string | undefined {
  try {
    return fs.readFileSync(hashFileFor(programName), "utf8").trim();
  } catch {
    return undefined;
  }
}

function saveProgramHash(programName: string, hash: string): void {
  fs.mkdirSync(DEPLOY_HASHES_DIR, { recursive: true });
  fs.writeFileSync(hashFileFor(programName), hash);
}

/// Patterns we know are transient surfpool/CLI race conditions, not bugs in
/// the program or genuine deploy failures. Re-running the deploy with a fresh
/// buffer almost always clears them.
const RETRYABLE_DEPLOY_ERRORS = [
  /already been processed/i,
  /Blockhash not found/i,
  /Custom program error: 0x0/i, // BPF Loader: account already in use after partial recovery
  /signature.*not.*found/i,
];

async function deployOne(p: { name: string; so: string; keypair: string }): Promise<void> {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const suffix = attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : "";
    console.log(`  [hooks] Deploying ${p.name}${suffix}...`);
    // `--use-rpc`: surfpool has no real TPU/QUIC endpoint; force JSON-RPC.
    // `--max-sign-attempts 10`: gives the CLI enough headroom to re-sign
    //   individual write chunks whose blockhash aged out, but stays low
    //   enough to avoid the "already processed" race that very high values
    //   trigger.
    const result = spawnSync(
      "solana",
      [
        "program", "deploy",
        "--url", RPC_URL,
        "--keypair", DEPLOY_WALLET,
        "--program-id", p.keypair,
        "--use-rpc",
        "--max-sign-attempts", "10",
        p.so,
      ],
      { cwd: PROJECT_ROOT, stdio: "pipe", encoding: "utf8" },
    );
    if (result.status === 0) {
      console.log(`  [hooks] Deployed ${p.name} (${pubKey(p.keypair)})`);
      return;
    }

    const combined = `${result.stdout}\n${result.stderr}`;
    const retryable =
      attempt < MAX_ATTEMPTS &&
      RETRYABLE_DEPLOY_ERRORS.some((re) => re.test(combined));
    if (retryable) {
      const firstLine = combined.split("\n").find((l) => l.trim().length > 0) ?? "";
      const cooldownMs = 3_000 * attempt; // back off: 3s, 6s, 9s
      console.log(
        `  [hooks] ${p.name}: transient deploy failure, retrying in ${cooldownMs / 1000}s — ${firstLine}`,
      );
      await new Promise((r) => setTimeout(r, cooldownMs));
      continue;
    }
    throw new Error(`Deploy ${p.name} failed:\n${combined}`);
  }
}

/**
 * Deploy only what's actually changed. For each program:
 *   - hash the built `.so` (sha256)
 *   - compare against the hash we recorded the last time we deployed it
 *   - check that the program account still exists on-chain (catches the case
 *     where surfpool was restarted since the last deploy and wiped state)
 *   - skip when both match; otherwise redeploy and immediately persist the
 *     new hash. Writing the hash file *after each* successful deploy means
 *     a partial failure (say, deploy of program 3/6 errors) leaves programs
 *     1 and 2 marked deployed, so the next run resumes at program 3.
 *
 * Hash cache lives under `target/` so `cargo clean` invalidates it.
 */
async function deployChangedPrograms(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");

  for (const p of PROGRAMS) {
    const programId = pubKey(p.keypair);
    const localHash = sha256File(path.join(PROJECT_ROOT, p.so));
    const cachedHash = loadProgramHash(p.name);
    const onChain = await connection.getAccountInfo(new PublicKey(programId));

    if (cachedHash === localHash && onChain != null) {
      console.log(`  [hooks] ${p.name}: up to date (${programId.slice(0, 8)}…)`);
      continue;
    }

    if (cachedHash === localHash && onChain == null) {
      console.log(`  [hooks] ${p.name}: hash matches cache but program missing on-chain — redeploying`);
    } else if (cachedHash && cachedHash !== localHash) {
      console.log(`  [hooks] ${p.name}: .so changed (${cachedHash.slice(0, 8)}… → ${localHash.slice(0, 8)}…) — redeploying`);
    } else {
      console.log(`  [hooks] ${p.name}: first deploy — deploying`);
    }

    await deployOne(p);
    saveProgramHash(p.name, localHash);
  }
}

function orcaPoolAddress(xusdMint: PublicKey): PublicKey {
  const [a, b] = PoolUtil.orderMints(xusdMint, USDC_MINT).map((m) => new PublicKey(m));
  return PDAUtil.getWhirlpool(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ORCA_WHIRLPOOLS_CONFIG,
    a,
    b,
    STABLE_TICK_SPACING,
  ).publicKey;
}

/**
 * Create the XUSD/USDC Orca pool if it doesn't exist yet; otherwise return its
 * (deterministic) address. Pool depends on the XUSD mint having been created
 * by peg_keeper, so call this *after* peg_keeper.initialize.
 */
async function getOrCreateOrcaPool(
  deployKeyPair: Keypair,
  xusdMint: PublicKey,
): Promise<PublicKey> {
  const connection = new Connection(RPC_URL, "confirmed");
  const poolAddress = orcaPoolAddress(xusdMint);
  if (await connection.getAccountInfo(poolAddress)) {
    log(`Orca pool already exists: ${poolAddress.toBase58()}`);
    return poolAddress;
  }

  log("Creating Orca XUSD/USDC whirlpool...");
  const wallet = new Wallet(deployKeyPair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const ctx = WhirlpoolContext.from(provider.connection, provider.wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);

  const [mintA, mintB] = PoolUtil.orderMints(xusdMint, USDC_MINT).map((m) => new PublicKey(m));
  const initialTick = PriceMath.priceToInitializableTickIndex(
    new Decimal(1),
    XUSD_DECIMALS,
    USDC_DECIMALS,
    STABLE_TICK_SPACING,
  );

  const { poolKey, tx } = await client.createPool(
    ORCA_WHIRLPOOLS_CONFIG,
    mintA,
    mintB,
    STABLE_TICK_SPACING,
    initialTick,
    deployKeyPair.publicKey,
  );
  const sig = await tx.buildAndExecute();
  log(`Orca pool created: ${poolKey.toBase58()} (sig ${sig})`);
  return poolKey;
}

/**
 * Init xive, fees, and peg_keeper. peg_keeper creates the XUSD mint (or no-ops
 * via `init_if_needed` when it already exists), which the Orca pool depends on
 * — so this must run *before* `getOrCreateOrcaPool` on a fresh chain.
 */
async function initPreOrca(deployKeyPair: Keypair, xusdMintKeypair: Keypair): Promise<void> {
  log("Initializing xive...");
  const xiveProgram = anchor.workspace.xive as Program<Xive>;
  await xiveProgram.methods
    .initialize()
    .accounts({ payer: deployKeyPair.publicKey })
    .signers([deployKeyPair])
    .rpc();

  log("Initializing fees...");
  const feesProgram = anchor.workspace.fees as Program<Fees>;
  await feesProgram.methods
    .initialize()
    .accounts({ payer: deployKeyPair.publicKey })
    .signers([deployKeyPair])
    .rpc();

  log("Initializing peg_keeper...");
  const pegKeeperProgram = anchor.workspace.pegKeeper as Program<PegKeeper>;
  await pegKeeperProgram.methods
    .initialize()
    .accounts({
      payer: deployKeyPair.publicKey,
      xusdMint: xusdMintKeypair.publicKey,
    })
    .signers([deployKeyPair, xusdMintKeypair])
    .rpc();
}

/**
 * Init the vault singleton against the (already-created) Orca pool.
 * `init_if_needed` on `lp_vault_mint` makes the mint side idempotent.
 */
async function initVault(deployKeyPair: Keypair, orcaPool: PublicKey): Promise<void> {
  log("Initializing vault...");
  const vaultMintKeypair = getKeyPair(VAULT_LP_MINT_KEY_PAIR);
  const vaultProgram = anchor.workspace.vault as Program<Vault>;
  await vaultProgram.methods
    .initialize(orcaPool)
    .accounts({
      payer: deployKeyPair.publicKey,
      lpVaultMint: vaultMintKeypair.publicKey,
    })
    .signers([deployKeyPair, vaultMintKeypair])
    .rpc();
}

async function addCollaterals(deployKeyPair: Keypair): Promise<void> {
  const collateralsProgram = anchor.workspace.collaterals as Program<Collaterals>;
  for (const token of Object.keys(COLLATERALS)) {
    const cfg = COLLATERALS[token as keyof typeof COLLATERALS];
    log(`Adding collateral ${token} (LTV ${cfg.tvl / 100}%)...`);
    await collateralsProgram.methods
      .updateCollateral(
        new anchor.BN(cfg.tvl),
        new anchor.BN(cfg.liqTvl),
        new anchor.BN(cfg.price),
        true,
      )
      .accounts({
        payer: deployKeyPair.publicKey,
        collateralMint: new PublicKey(cfg.mint),
      })
      .signers([deployKeyPair])
      .rpc();
  }
}

/**
 * Per-test-file reset: wipe all program-owned PDAs + protocol-managed ATAs,
 * then re-initialize the singletons and re-add the collateral registry. The
 * deployed programs, mints, and the Orca pool persist between calls.
 *
 * Call this from each test file's `before`.
 */
export async function setupProtocol(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  const deployKeyPair = getKeyPair(DEPLOY_WALLET);
  const xusdMintKeypair = getKeyPair(XUSD_MINT_KEY_PAIR);

  const { pdas, atas } = await purgeProgramAccounts(connection);
  log(`Purged ${pdas} PDAs, ${atas} protocol-managed ATAs`);

  // Order matters on a fresh chain:
  //   1. peg_keeper creates the XUSD mint (via init_if_needed; idempotent)
  //   2. Orca pool can only be created/queried once the XUSD mint exists
  //   3. vault needs the pool address as init argument
  await initPreOrca(deployKeyPair, xusdMintKeypair);
  const orcaPool = await getOrCreateOrcaPool(deployKeyPair, xusdMintKeypair.publicKey);
  await initVault(deployKeyPair, orcaPool);
  await addCollaterals(deployKeyPair);
}

/**
 * One-time bootstrap: fund wallets, build, deploy *only* what changed.
 *
 * No `surfnet_resetNetwork`: state cleanup is per-file via `setupProtocol()`.
 * That makes the deploy-skip meaningful — if the user re-runs the suite
 * without touching the programs, nothing gets redeployed.
 */
async function bootstrap(): Promise<void> {
  const deployKeyPair = getKeyPair(DEPLOY_WALLET);
  const testKeyPair = getKeyPair(TEST_WALLET);

  await Promise.all([
    fundWallet(deployKeyPair, "Deploy"),
    fundWallet(testKeyPair, "Test"),
  ]);
  buildPrograms();
  await deployChangedPrograms();
}

export const mochaHooks = {
  async beforeAll() {
    console.log("  [hooks] Waiting for RPC...");
    await poll(isRpcUp, 30_000, "Surfpool RPC");

    await bootstrap();

    console.log("  [hooks] Ready");
  },
};
