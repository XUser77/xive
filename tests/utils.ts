import { spawnSync } from "child_process";
import fs from "node:fs";
import * as anchor from "@anchor-lang/core";

export const PROJECT_ROOT = process.cwd();
export const RPC_URL = "http://127.0.0.1:8899";

export function pubKey(keypairPath: string): string {
  const r = spawnSync("solana-keygen", ["pubkey", keypairPath], {
    cwd: PROJECT_ROOT, encoding: "utf8", stdio: "pipe",
  });
  return r.stdout.trim();
}

export async function rpcCall(method: string, params: any[] = []): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

export async function isRpcUp(): Promise<boolean> {
  try {
    const data = await rpcCall("getHealth");
    return data.result === "ok";
  } catch (e) {
    console.info(e);
    return false;
  }
}

export async function poll(
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

export function getKeyPair(path: string) {
  const keypairFile = fs.readFileSync(path, "utf-8");
  const keypairData = JSON.parse(keypairFile);
  return anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(keypairData)
  );
}
