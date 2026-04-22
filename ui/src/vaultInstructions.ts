import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  LP_VAULT_MINT,
  TOKEN_PROGRAM_ID,
  VAULT_PROGRAM_ID,
  XIVE_PROGRAM_ID,
  XUSD_MINT,
} from "./config";
import { ata, collateralPda, vaultPda, xivePda } from "./pdas";

const DISCRIMINATOR_DEPOSIT = new Uint8Array([
  242, 35, 198, 137, 82, 225, 242, 182,
]);
const DISCRIMINATOR_WITHDRAW = new Uint8Array([
  183, 18, 70, 156, 148, 109, 161, 34,
]);
const DISCRIMINATOR_LIQUIDATE = new Uint8Array([
  223, 179, 226, 125, 48, 46, 39, 74,
]);

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function vaultActionKeys(user: PublicKey) {
  const vault = vaultPda();
  return [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
    { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
    { pubkey: ata(vault, XUSD_MINT), isSigner: false, isWritable: true },
    { pubkey: LP_VAULT_MINT, isSigner: false, isWritable: true },
    { pubkey: ata(user, LP_VAULT_MINT), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

export function vaultDepositIx(args: {
  user: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: vaultActionKeys(args.user),
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_DEPOSIT), u64LE(args.amount)]),
  });
}

export function vaultWithdrawIx(args: {
  user: PublicKey;
  lpAmount: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: vaultActionKeys(args.user),
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_WITHDRAW), u64LE(args.lpAmount)]),
  });
}

export function vaultLiquidateIx(args: {
  payer: PublicKey;
  position: PublicKey;
  collateralMint: PublicKey;
}): TransactionInstruction {
  const { payer, position, collateralMint } = args;
  const vault = vaultPda();
  const xive = xivePda();
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: xive, isSigner: false, isWritable: true },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: ata(vault, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: ata(vault, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: XIVE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(DISCRIMINATOR_LIQUIDATE),
  });
}
