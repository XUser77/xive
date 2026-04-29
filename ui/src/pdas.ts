import { PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPF_UPGRADEABLE_LOADER_ID,
  COLLATERALS_PROGRAM_ID,
  PEG_KEEPER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  VAULT_PROGRAM_ID,
  XIVE_PROGRAM_ID,
} from "./config";

export function xiveProgramDataPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [XIVE_PROGRAM_ID.toBuffer()],
    BPF_UPGRADEABLE_LOADER_ID,
  )[0];
}

export function xivePda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("xive")],
    XIVE_PROGRAM_ID,
  )[0];
}

export function collateralPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), mint.toBuffer()],
    COLLATERALS_PROGRAM_ID,
  )[0];
}

export function userCounterPda(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user-counter"), user.toBuffer()],
    XIVE_PROGRAM_ID,
  )[0];
}

export function positionPda(user: PublicKey, counter: bigint): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(counter);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), buf],
    XIVE_PROGRAM_ID,
  )[0];
}

export function vaultPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    VAULT_PROGRAM_ID,
  )[0];
}

export function pegKeeperPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("peg-keeper")],
    PEG_KEEPER_PROGRAM_ID,
  )[0];
}

export function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
