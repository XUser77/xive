/**
 * Mocha Root Hooks — runs once before the entire test suite.
 * Starts Surfpool (mainnet fork) and deploys programs if not already running.
 */
import { spawn, spawnSync } from "child_process";
import path from "path";

const RPC_URL = "http://127.0.0.1:8899";
const PROJECT_ROOT = process.cwd();
const WALLET = path.join(PROJECT_ROOT, "keys/test-wallet.json");

const PROGRAM_IDS = [
  "Aiz3dMSA1y45gdU4Z1xYxirRYW5HErYx4LgY8voHNkLJ", // xive
  "BShpFcv65t5sJMFWEZEufsCcU7imeQSakZw1xZjLNJGu", // peg_keeper
  "3qiZw1HDmqhT2gQj5MQyfFetxe9Hx8CUPJiTsCs9LFkm", // collateral
];

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

async function areProgramsDeployed(): Promise<boolean> {
  try {
    for (const id of PROGRAM_IDS) {
      const res = await rpcCall("getAccountInfo", [id, { encoding: "base64" }]);
      if (!res.result?.value) return false;
    }
    return true;
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

const PROGRAMS: { name: string; so: string; keypair: string }[] = [
  { name: "collateral", so: "target/deploy/collateral.so", keypair: "target/deploy/collateral-keypair.json" },
  { name: "peg_keeper", so: "target/deploy/peg_keeper.so", keypair: "target/deploy/peg_keeper-keypair.json" },
  { name: "xive",       so: "target/deploy/xive.so",       keypair: "target/deploy/xive-keypair.json" },
];

function deployPrograms(): void {
  for (const { name, so, keypair } of PROGRAMS) {
    console.log(`  [hooks] Deploying ${name}...`);
    const result = spawnSync(
      "solana",
      [
        "program", "deploy",
        "--url", RPC_URL,
        "--keypair", WALLET,
        "--program-id", keypair,
        so,
      ],
      { cwd: PROJECT_ROOT, stdio: "pipe", encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`Deploy ${name} failed:\n${result.stdout}\n${result.stderr}`);
    }
  }
  console.log("  [hooks] Programs deployed");
}

function walletPubkey(): string {
  const result = spawnSync("solana-keygen", ["pubkey", WALLET], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.stdout.trim();
}

async function resetAndDeploy(): Promise<void> {
  console.log("  [hooks] Resetting network state...");
  await rpcCall("surfnet_resetNetwork");

  // Re-fund test wallet after reset (balance was cleared)
  const pubkey = walletPubkey();
  console.log(`  [hooks] Funding test wallet ${pubkey}...`);
  await rpcCall("surfnet_setAccount", [
    pubkey,
    { lamports: 100_000_000_000 }, // 100 SOL
  ]);

  deployPrograms();
  await poll(areProgramsDeployed, 30_000, "program deployment");
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
        "--airdrop-keypair-path", WALLET,
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
