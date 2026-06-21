import { PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  VAULT_PROGRAM_ID,
  XIVE_PROGRAM_ID,
} from "./config";

export function xivePda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("xive")],
    XIVE_PROGRAM_ID,
  )[0];
}

// Collateral config now lives inside the `xive` program (seed ["collateral", mint]).
export function collateralPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), mint.toBuffer()],
    XIVE_PROGRAM_ID,
  )[0];
}

// Per-borrower monotonic position counter (seed ["wallet", borrower]).
export function walletPda(borrower: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), borrower.toBuffer()],
    XIVE_PROGRAM_ID,
  )[0];
}

// Position PDA (seed ["pos", borrower, index]).
export function positionPda(borrower: PublicKey, index: bigint): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pos"), borrower.toBuffer(), buf],
    XIVE_PROGRAM_ID,
  )[0];
}

export function vaultPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    VAULT_PROGRAM_ID,
  )[0];
}

export function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
