import { spawnSync } from "child_process";
import fs from "node:fs";
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Collaterals } from "../target/types/collaterals.ts";

export const PROJECT_ROOT = process.cwd();
export const RPC_URL = "http://127.0.0.1:8899";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// Program IDs from Anchor.toml — kept here as plain strings to avoid pulling the
/// IDLs into utils. Must stay in sync with `[programs.localnet]`.
export const PROGRAM_IDS: PublicKey[] = [
  "xcoL9qKXpLrXb67xNBzfsXboH8zsC9SorT9rES2viA3", // collaterals
  "xfeewAjbVVJkjXUaxQxSmWgLNrixEFMJN3oNhNxQvCY", // fees
  "xpeguefXy5MrgkbirCyuCCD5EfbUM5UfejdQduDcGz6", // peg_keeper
  "xtm3VMkqiNhP2rd74yZUzsXFZMyAJapmcP7HUSfwD4i", // team
  "xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK", // vault
  "xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR", // xive
].map((id) => new PublicKey(id));

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

/// Zero out every account owned by our programs (PDAs) and every SPL token
/// account whose authority is one of those PDAs (the protocol-managed ATAs).
/// Solana garbage-collects accounts with `lamports = 0`, so subsequent
/// `init` / `init_if_needed` constraints will succeed again.
///
/// User-owned ATAs (authority = user wallet) are left untouched. To wipe
/// everything including the deployed programs themselves, use
/// `rpcCall("surfnet_resetNetwork")` instead.
export async function purgeProgramAccounts(
  connection: Connection,
): Promise<{ pdas: number; atas: number }> {
  // 1. Every account owned by one of our programs.
  const pdasByProgram = await Promise.all(
    PROGRAM_IDS.map((pid) =>
      connection.getProgramAccounts(pid, {
        dataSlice: { offset: 0, length: 0 },
      }),
    ),
  );
  const pdas = pdasByProgram.flatMap((arr) => arr.map((r) => r.pubkey));

  // 2. SPL token accounts whose authority field (offset 32, 32 bytes) is one of those PDAs.
  const atasByPda = await Promise.all(
    pdas.map((pda) =>
      connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
        dataSlice: { offset: 0, length: 0 },
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 32, bytes: pda.toBase58() } },
        ],
      }),
    ),
  );
  const atas = atasByPda.flatMap((arr) => arr.map((r) => r.pubkey));

  // 3. Wipe.
  await Promise.all(
    [...pdas, ...atas].map((pk) =>
      rpcCall("surfnet_setAccount", [pk.toBase58(), { lamports: 0 }]),
    ),
  );

  return { pdas: pdas.length, atas: atas.length };
}

/// Fetch the `Collateral` PDA (`["collateral", mint]`) for the given mint and
/// return its deserialized fields.
export async function getCollateral(
  collateralsProgram: Program<Collaterals>,
  collateralMint: PublicKey,
) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), collateralMint.toBuffer()],
    collateralsProgram.programId,
  );
  return collateralsProgram.account.collateral.fetch(pda);
}
