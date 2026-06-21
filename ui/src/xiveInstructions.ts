import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  XIVE_PROGRAM_ID,
  XUSD_MINT,
} from "./config";
import {
  ata,
  collateralPda,
  positionPda,
  walletPda,
  xivePda,
} from "./pdas";

// Instruction discriminators — must match target/idl/xive.json.
const DISCRIMINATOR_INIT_WALLET = new Uint8Array([
  141, 132, 233, 130, 168, 183, 10, 119,
]);
const DISCRIMINATOR_OPEN_POSITION = new Uint8Array([
  135, 128, 47, 77, 15, 152, 240, 49,
]);
const DISCRIMINATOR_DEPOSIT = new Uint8Array([
  242, 35, 198, 137, 82, 225, 242, 182,
]);
const DISCRIMINATOR_WITHDRAW = new Uint8Array([
  183, 18, 70, 156, 148, 109, 161, 34,
]);
const DISCRIMINATOR_BORROW = new Uint8Array([
  228, 253, 131, 202, 207, 116, 89, 18,
]);
const DISCRIMINATOR_REPAY = new Uint8Array([
  234, 103, 67, 82, 208, 234, 219, 166,
]);
const DISCRIMINATOR_SET_COLLATERAL_PRICE = new Uint8Array([
  207, 218, 194, 201, 118, 198, 249, 204,
]);
const DISCRIMINATOR_UPDATE_COLLATERAL = new Uint8Array([
  218, 227, 184, 124, 133, 81, 157, 131,
]);

// `Wallet` account discriminator.
const DISCRIMINATOR_WALLET = new Uint8Array([
  24, 89, 59, 139, 81, 154, 232, 95,
]);

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function u16LE(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}

/// Read the borrower's next position index from their `Wallet` PDA.
/// Returns null when the wallet has not been initialized yet.
export async function fetchWalletIndex(
  connection: Connection,
  borrower: PublicKey,
): Promise<bigint | null> {
  const pda = walletPda(borrower);
  const info = await connection.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const data = info.data;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== DISCRIMINATOR_WALLET[i]) {
      throw new Error("wallet has unexpected discriminator");
    }
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // layout: discriminator(8) + bump(1) + borrower(32) + index(u64)
  return view.getBigUint64(8 + 1 + 32, true);
}

export function initWalletIx(borrower: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: borrower, isSigner: true, isWritable: true },
      { pubkey: walletPda(borrower), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(DISCRIMINATOR_INIT_WALLET),
  });
}

export function setPriceIx(args: {
  authority: PublicKey;
  collateralMint: PublicKey;
  price: bigint;
}): TransactionInstruction {
  const { authority, collateralMint, price } = args;
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR_SET_COLLATERAL_PRICE),
      u64LE(price),
    ]),
  });
}

/// Create or update a collateral's config. `init_if_needed` on chain, so the
/// first call for a mint *adds* it (creating the program collateral ATA);
/// later calls edit it. Setting `enabled = false` "removes" it (disables new
/// borrows against it). `ltv` / `liquidationLtv` are basis points
/// (`ltv <= liquidationLtv <= 10_000`).
export function updateCollateralIx(args: {
  authority: PublicKey;
  collateralMint: PublicKey;
  enabled: boolean;
  ltv: number;
  liquidationLtv: number;
}): TransactionInstruction {
  const { authority, collateralMint, enabled, ltv, liquidationLtv } = args;
  const xive = xivePda();
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: true },
      { pubkey: xive, isSigner: false, isWritable: false },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR_UPDATE_COLLATERAL),
      Buffer.from([enabled ? 1 : 0]),
      u16LE(ltv),
      u16LE(liquidationLtv),
    ]),
  });
}

export function openPositionIx(args: {
  user: PublicKey;
  collateralMint: PublicKey;
  index: bigint;
  collateralAmount: bigint;
  loanAmount: bigint;
}): TransactionInstruction {
  const { user, collateralMint, index, collateralAmount, loanAmount } = args;
  const xive = xivePda();
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: walletPda(user), isSigner: false, isWritable: true },
      { pubkey: positionPda(user, index), isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(user, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: false },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: xive, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR_OPEN_POSITION),
      u64LE(collateralAmount),
      u64LE(loanAmount),
    ]),
  });
}

export function depositIx(args: {
  user: PublicKey;
  position: PublicKey;
  collateralMint: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const { user, position, collateralMint, amount } = args;
  const xive = xivePda();
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: true },
      { pubkey: ata(user, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: xive, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_DEPOSIT), u64LE(amount)]),
  });
}

export function withdrawIx(args: {
  user: PublicKey;
  position: PublicKey;
  collateralMint: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const { user, position, collateralMint, amount } = args;
  const xive = xivePda();
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: false },
      { pubkey: collateralMint, isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(user, collateralMint), isSigner: false, isWritable: true },
      { pubkey: xive, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_WITHDRAW), u64LE(amount)]),
  });
}

export function borrowIx(args: {
  user: PublicKey;
  position: PublicKey;
  collateralMint: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const { user, position, collateralMint, amount } = args;
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: false },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: xivePda(), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_BORROW), u64LE(amount)]),
  });
}

export function repayIx(args: {
  user: PublicKey;
  position: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const { user, position, amount } = args;
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: xivePda(), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_REPAY), u64LE(amount)]),
  });
}
