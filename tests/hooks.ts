/**
 * Mocha Root Hooks — runs once before the entire test suite.
 * Starts Surfpool (mainnet fork) and deploys programs if not already running.
 */
import { spawn, spawnSync } from "child_process";
import path from "path";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as anchor from "@anchor-lang/core";
import * as fs from "node:fs";
import {Program} from "@anchor-lang/core";
import type { PegKeeper } from "../target/types/peg_keeper.ts";
import type { Xive } from "../target/types/xive.ts";

const RPC_URL = "http://127.0.0.1:8899";
const PROJECT_ROOT = process.cwd();
const DEPLOY_WALLET = path.join(PROJECT_ROOT, "keys/deploy-wallet.json");
const TEST_WALLET = path.join(PROJECT_ROOT, "keys/test-wallet.json");

const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");

const PROGRAMS: { name: string; so: string; keypair: string }[] = [
  { name: "collateral", so: "target/deploy/collateral.so", keypair: "target/deploy/collateral-keypair.json" },
  { name: "peg_keeper", so: "target/deploy/peg_keeper.so", keypair: "keys/peg-keeper-program.json" },
  { name: "xive",       so: "target/deploy/xive.so",       keypair: "keys/xive-program.json" },
];

const XUSD_MINT_KEY_PAIR = "keys/xusd-mint-keypair.json";

function pubKey(keypairPath: string): string {
  const r = spawnSync("solana-keygen", ["pubkey", keypairPath], {
    cwd: PROJECT_ROOT, encoding: "utf8", stdio: "pipe",
  });
  return r.stdout.trim();
}

function log(line: string, ...args: any[]) {
  if (args.length == 0) {
    console.log(`  [hooks] ${line}`);
  } else {
    console.log(`  [hooks] ${line}`, args);
  }
}

async function rpcCall(method: string, params: any[] = []): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

async function isRpcUp(): Promise<boolean> {
  try {
    const data = await rpcCall("getHealth");
    return data.result === "ok";
  } catch {
    return false;
  }
}

async function poll(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function getKeyPair(path: string) {
  const keypairFile = fs.readFileSync(path, "utf-8");
  const keypairData = JSON.parse(keypairFile);
  return anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(keypairData)
  );
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

async function resetAndDeploy(): Promise<void> {
  console.log("  [hooks] Resetting network state...");
  await rpcCall("surfnet_resetNetwork");

  const deployKeyPair = getKeyPair(DEPLOY_WALLET);
  const testKeyPair = getKeyPair(TEST_WALLET);

  // Re-fund test wallet after reset (balance was cleared)

  const deployPubkey = deployKeyPair.publicKey.toBase58();
  console.log(`  [hooks] Funding deploy wallet ${deployPubkey}...`);
  await rpcCall("surfnet_setAccount", [
    deployPubkey,
    { lamports: 100_000_000_000 }, // 100 SOL
  ]);

  const testPubKey = testKeyPair.publicKey.toBase58();
  console.log(`  [hooks] Funding test wallet ${testPubKey}...`);
  await rpcCall("surfnet_setAccount", [
    testPubKey,
    { lamports: 100_000_000_000 }, // 100 SOL
  ]);

  buildPrograms();
  deployPrograms();
  await initPrograms(deployKeyPair);
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
