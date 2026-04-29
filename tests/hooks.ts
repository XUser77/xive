/**
 * Mocha Root Hooks — runs once before the entire test suite.
 * Starts Surfpool (mainnet fork) and deploys programs if not already running.
 */
import { spawnSync } from "child_process";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@anchor-lang/core";
import {Program} from "@anchor-lang/core";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG,
  PriceMath,
  PoolUtil,
} from "@orca-so/whirlpools-sdk";
import Decimal from "decimal.js";
import type { PegKeeper } from "../target/types/peg_keeper.ts";
import type { Xive } from "../target/types/xive.ts";
import type { Vault } from "../target/types/vault.js";
import { PROJECT_ROOT, RPC_URL, pubKey, rpcCall, isRpcUp, poll, getKeyPair } from "./utils.js";

const DEPLOY_WALLET = path.join(PROJECT_ROOT, "keys/deploy-wallet.json");
const TEST_WALLET = path.join(PROJECT_ROOT, "keys/test-wallet.json");

const COLLATERALS = {
  WETH: {
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    tvl: 9000, // 90%
    liqTvl: 9500, // 95%
    price: 3000,
  },
  WBTC: {
    mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    tvl: 9000, // 90%
    liqTvl: 9500, // 95%
    price: 70000
  },
};

const PROGRAMS: { name: string; so: string; keypair: string }[] = [
  { name: "peg_keeper", so: "target/deploy/peg_keeper.so", keypair: "keys/peg-keeper-program.json" },
  { name: "team",       so: "target/deploy/team.so",       keypair: "keys/team-program.json" },
  { name: "vault",      so: "target/deploy/vault.so",      keypair: "keys/vault-program.json" },
  { name: "xive",       so: "target/deploy/xive.so",       keypair: "keys/xive-program.json" },
];

const XUSD_MINT_KEY_PAIR = "keys/xusd-mint-keypair.json";
const VAULT_LP_MINT_KEY_PAIR = "keys/vault-mint-keypair.json";

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
  const result = spawnSync(
    "anchor",
    [
      "build",
    ],
    { cwd: PROJECT_ROOT, stdio: "pipe", encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Build failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function deployPrograms(): void {
  for (const { name, so, keypair } of PROGRAMS) {
    console.log(`  [hooks] Deploying ${name}...`);
    const result = spawnSync(
      "solana",
      [
        "program", "deploy",
        "--url", RPC_URL,
        "--keypair", DEPLOY_WALLET,
        "--program-id", keypair,
        so,
      ],
      { cwd: PROJECT_ROOT, stdio: "pipe", encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`Deploy ${name} failed:\n${result.stdout}\n${result.stderr}`);
    }
    const id = pubKey(keypair);
    console.log(`  [hooks] Deployed ${name} program: ${id}`)
  }
  console.log("  [hooks] Programs deployed");
}

async function initializeOrcaPool(deployKeyPair: Keypair, xusdMint: PublicKey): Promise<PublicKey> {
  log("Initializing Orca XUSD/USDC whirlpool...");
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(deployKeyPair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const ctx = WhirlpoolContext.from(provider.connection, provider.wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);

  const [mintA, mintB] = PoolUtil.orderMints(xusdMint, USDC_MINT).map((m) => new PublicKey(m));
  // 1 XUSD = 1 USDC (both 6 decimals) — price is 1.0 regardless of mint order.
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

async function initPrograms(deployKeyPair: Keypair): Promise<void> {
  log("Initializing xive...");
  const xiveProgram = anchor.workspace.xive as Program<Xive>;
  await xiveProgram.methods
    .initialize()
    .accounts({
      payer: deployKeyPair.publicKey
    })
    .signers([deployKeyPair])
    .rpc();
  log("Xive initialized");

  log("Initializing peg_keeper...");
  const pegKeeperProgram = anchor.workspace.pegKeeper as Program<PegKeeper>;
  const xusdMintAccountKeypair = getKeyPair(XUSD_MINT_KEY_PAIR);
  await pegKeeperProgram.methods
    .initialize()
    .accounts({
      payer: deployKeyPair.publicKey,
      xusdMint: xusdMintAccountKeypair.publicKey
    })
    .signers([deployKeyPair, xusdMintAccountKeypair])
    .rpc();
  log("Peg keeper initialized");
  log(`XUSD address: ${xusdMintAccountKeypair.publicKey.toBase58()}`);

  const orcaPool = await initializeOrcaPool(deployKeyPair, xusdMintAccountKeypair.publicKey);

  log("Initializing vault...");
  const vaultProgram = anchor.workspace.vault as Program<Vault>;
  const vaultMintAccountKeyPair = getKeyPair(VAULT_LP_MINT_KEY_PAIR);
  await vaultProgram.methods
    .initialize(orcaPool)
    .accounts({
      payer: deployKeyPair.publicKey,
      lpVaultMint: vaultMintAccountKeyPair.publicKey
    })
    .signers([deployKeyPair, vaultMintAccountKeyPair])
    .rpc();
  log("Vault initialized");
  log(`VaultLP address: ${vaultMintAccountKeyPair.publicKey.toBase58()}`);
}

async function addCollaterals(deployKeyPair: Keypair): Promise<void> {
  const xiveProgram = anchor.workspace.xive as Program<Xive>;
  for (const token in COLLATERALS) {
    log(`Adding collateral ${token} (${COLLATERALS[token].tvl / 100.0} %)...`);
    await xiveProgram.methods
      .allowCollateral(
        new anchor.BN(COLLATERALS[token].tvl),
        new anchor.BN(COLLATERALS[token].liqTvl),
        new anchor.BN(COLLATERALS[token].price)
      )
      .accounts({
        payer: deployKeyPair.publicKey,
        collateralMint: new PublicKey(COLLATERALS[token].mint),
      })
      .signers([deployKeyPair])
      .rpc();
  }
}

async function resetAndDeploy(): Promise<void> {
  console.log("  [hooks] Resetting network state...");
  await rpcCall("surfnet_resetNetwork");

  // Fund, build, deploy, init
  const deployKeyPair = getKeyPair(DEPLOY_WALLET);
  const testKeyPair = getKeyPair(TEST_WALLET);

  await Promise.all([
    fundWallet(deployKeyPair, "Deploy"),
    fundWallet(testKeyPair, "Test")
  ]);
  buildPrograms();
  deployPrograms();
  await initPrograms(deployKeyPair);
  await addCollaterals(deployKeyPair);
}

export const mochaHooks = {
  async beforeAll() {
    console.log("  [hooks] Waiting for RPC...");
    await poll(isRpcUp, 30_000, "Surfpool RPC");

    await resetAndDeploy();

    console.log("  [hooks] Ready");
  },
};
