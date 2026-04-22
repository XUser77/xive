import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PEG_KEEPER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  XIVE_PROGRAM_ID,
  XUSD_MINT,
} from "./config";
import {
  ata,
  collateralPda,
  pegKeeperPda,
  positionPda,
  userCounterPda,
  xivePda,
} from "./pdas";

const DISCRIMINATOR_CREATE_USER_STATE = new Uint8Array([
  232, 218, 90, 168, 17, 194, 189, 58,
]);
const DISCRIMINATOR_OPEN_POSITION = new Uint8Array([
  135, 128, 47, 77, 15, 152, 240, 49,
]);
const DISCRIMINATOR_USER_COUNTER = new Uint8Array([
  154, 114, 103, 93, 77, 57, 80, 227,
]);
const DISCRIMINATOR_SET_PRICE = new Uint8Array([
  16, 19, 182, 8, 149, 83, 72, 181,
]);
const DISCRIMINATOR_REPAY = new Uint8Array([
  234, 103, 67, 82, 208, 234, 219, 166,
]);
const DISCRIMINATOR_BORROW = new Uint8Array([
  228, 253, 131, 202, 207, 116, 89, 18,
]);
const DISCRIMINATOR_DEPOSIT_COLLATERAL = new Uint8Array([
  156, 131, 142, 116, 146, 247, 162, 120,
]);
const DISCRIMINATOR_WITHDRAW_COLLATERAL = new Uint8Array([
  115, 135, 168, 106, 139, 214, 138, 150,
]);

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

export async function fetchUserCounter(
  connection: Connection,
  user: PublicKey,
): Promise<bigint | null> {
  const pda = userCounterPda(user);
  const info = await connection.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const data = info.data;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== DISCRIMINATOR_USER_COUNTER[i]) {
      throw new Error("user_counter has unexpected discriminator");
    }
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(9, true);
}

export function createUserStateIx(user: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userCounterPda(user), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(DISCRIMINATOR_CREATE_USER_STATE),
  });
}

export function setPriceIx(args: {
  payer: PublicKey;
  collateralMint: PublicKey;
  price: bigint;
}): TransactionInstruction {
  const { payer, collateralMint, price } = args;
  const data = Buffer.concat([
    Buffer.from(DISCRIMINATOR_SET_PRICE),
    u64LE(price),
  ]);
  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: true },
    ],
    data,
  });
}

export function openPositionIx(args: {
  user: PublicKey;
  collateralMint: PublicKey;
  counter: bigint;
  collateralAmount: bigint;
  loanAmount: bigint;
}): TransactionInstruction {
  const {
    user,
    collateralMint,
    counter,
    collateralAmount,
    loanAmount,
  } = args;

  const xive = xivePda();
  const data = Buffer.concat([
    Buffer.from(DISCRIMINATOR_OPEN_POSITION),
    u64LE(collateralAmount),
    u64LE(loanAmount),
  ]);

  return new TransactionInstruction({
    programId: XIVE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: xive, isSigner: false, isWritable: false },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: false },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: ata(user, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: pegKeeperPda(), isSigner: false, isWritable: false },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: userCounterPda(user), isSigner: false, isWritable: true },
      { pubkey: positionPda(user, counter), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: PEG_KEEPER_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
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
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_REPAY), u64LE(amount)]),
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
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: xivePda(), isSigner: false, isWritable: false },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: false },
      { pubkey: pegKeeperPda(), isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PEG_KEEPER_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_BORROW), u64LE(amount)]),
  });
}

export function depositCollateralIx(args: {
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
      { pubkey: xive, isSigner: false, isWritable: false },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: ata(user, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR_DEPOSIT_COLLATERAL),
      u64LE(amount),
    ]),
  });
}

export function withdrawCollateralIx(args: {
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
      { pubkey: xive, isSigner: false, isWritable: false },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: false },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: ata(user, collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR_WITHDRAW_COLLATERAL),
      u64LE(amount),
    ]),
  });
}
