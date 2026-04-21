import type { PublicKey } from "@solana/web3.js";

import { RPC_ENDPOINT } from "./config";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = (await res.json()) as JsonRpcResponse<T>;
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result as T;
}

export async function surfnetSetTokenAccount(
  owner: PublicKey,
  mint: PublicKey,
  amount: bigint,
): Promise<void> {
  await rpcCall<unknown>("surfnet_setTokenAccount", [
    owner.toBase58(),
    mint.toBase58(),
    { amount: Number(amount) },
  ]);
}

export async function surfnetSetAccount(
  owner: PublicKey,
  lamports: bigint,
): Promise<void> {
  await rpcCall<unknown>("surfnet_setAccount", [
    owner.toBase58(),
    { lamports: Number(lamports) },
  ]);
}
