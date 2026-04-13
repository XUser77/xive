/**
 * Mocha Root Hooks — runs once before the entire test suite.
 * Starts Surfpool (mainnet fork) and deploys programs if not already running.
 */
import { spawn, spawnSync } from "child_process";
import path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@anchor-lang/core";
import {Program} from "@anchor-lang/core";
import type { PegKeeper } from "../target/types/peg_keeper.ts";
import type { Xive } from "../target/types/xive.ts";
import { PROJECT_ROOT, RPC_URL, pubKey, rpcCall, isRpcUp, poll, getKeyPair } from "./utils.js";

const DEPLOY_WALLET = path.join(PROJECT_ROOT, "keys/deploy-wallet.json");
const TEST_WALLET = path.join(PROJECT_ROOT, "keys/test-wallet.json");

const COLLATERALS = {
  WETH: {
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    tvl: 9000 // 90%
  },
  WBTC: {
    mint: '5XZw2LKTyrfvfiskJ78AMpackRjPcyCif1WhUsPDuVqQ',
    tvl: 9000 // 90%
  },
};

const PROGRAMS: { name: string; so: string; keypair: string }[] = [
  { name: "peg_keeper", so: "target/deploy/peg_keeper.so", keypair: "keys/peg-keeper-program.json" },
  { name: "xive",       so: "target/deploy/xive.so",       keypair: "keys/xive-program.json" },
];

const XUSD_MINT_KEY_PAIR = "keys/xusd-mint-keypair.json";

function log(line: string, ...args: any[]) {
  if (args.length == 0) {
    console.log(`  [hooks] ${line}`);
  } else {
    console.log(`  [hooks] ${line}`, args);
  }
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
  // Peg Keeper
  const pegKeeperProgram = anchor.workspace.pegKeeper as Program<PegKeeper>;
  const mintAccountKeypair = getKeyPair(XUSD_MINT_KEY_PAIR);
  await pegKeeperProgram.methods
    .initialize()
    .accounts({
      payer: deployKeyPair.publicKey,
      xusdMint: mintAccountKeypair.publicKey
    })
    .signers([deployKeyPair, mintAccountKeypair])
    .rpc();
  log("Peg keeper initialized");
  log(`XUSD address: ${mintAccountKeypair.publicKey.toBase58()}`);
}

async function addCollaterals(deployKeyPair: Keypair): Promise<void> {
  const xiveProgram = anchor.workspace.xive as Program<Xive>;
  for (const token in COLLATERALS) {
    log(`Adding collateral ${token} (${COLLATERALS[token].tvl / 100.0} %)...`);
    await xiveProgram.methods
      .allowCollateral(new anchor.BN(COLLATERALS[token].tvl))
      .accounts({
        admin: deployKeyPair.publicKey,
        collateralMint: new PublicKey(COLLATERALS[token].mint),
      })
      .signers([deployKeyPair])
      .rpc();
  }
}

async function resetAndDeploy(): Promise<void> {
  console.log("  [hooks] Resetting network state...");
  await rpcCall("surfnet_resetNetwork");

  // Fund wallets after reset (balance was cleared)
  const deployKeyPair = getKeyPair(DEPLOY_WALLET);
  const testKeyPair = getKeyPair(TEST_WALLET);
  for (const keyPair of [deployKeyPair, testKeyPair]) {
    log(`Funding wallet ${keyPair.publicKey.toBase58()}...`);
    await rpcCall("surfnet_setAccount", [
      keyPair.publicKey,
      { lamports: 100_000_000_000 }, // 100 SOL
    ]);
  }

  // Build, deploy, init
  buildPrograms();
  deployPrograms();
  await initPrograms(deployKeyPair);
  await addCollaterals(deployKeyPair);
}

export const mochaHooks = {
  async beforeAll() {
    if (await isRpcUp()) {
      console.log("  [hooks] Surfpool already running — resetting state");
      await resetAndDeploy();
      return;
    }

    console.log("  [hooks] Starting Surfpool (mainnet fork, no auto-deploy)...");

    const proc = spawn(
      "surfpool",
      [
        "start",
        "--network", "mainnet",
        "--legacy-anchor-compatibility",
        "--no-deploy",
        "--airdrop-keypair-path", DEPLOY_WALLET,
        "--ci",
        "--daemon",
      ],
      { cwd: PROJECT_ROOT, stdio: "ignore", detached: true },
    );
    proc.unref();

    console.log("  [hooks] Waiting for RPC...");
    await poll(isRpcUp, 30_000, "Surfpool RPC");

    await resetAndDeploy();

    console.log("  [hooks] Surfpool ready");
  },
};
