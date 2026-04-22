import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { XIVE_PROGRAM_ID } from "./config";

const POSITION_DISCRIMINATOR = new Uint8Array([
  170, 188, 143, 228, 122, 64, 247, 208,
]);

const POSITION_SIZE = 8 + 1 + 32 + 32 + 8 + 8;

export type Position = {
  address: PublicKey;
  user: PublicKey;
  collateralMint: PublicKey;
  collateralAmount: bigint;
  loanAmount: bigint;
};

function decode(address: PublicKey, data: Buffer): Position {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8 + 1; // skip discriminator + bump
  const user = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const collateralMint = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const collateralAmount = view.getBigUint64(o, true);
  o += 8;
  const loanAmount = view.getBigUint64(o, true);
  return { address, user, collateralMint, collateralAmount, loanAmount };
}

export async function fetchUserPositions(
  connection: Connection,
  user: PublicKey,
): Promise<Position[]> {
  const accounts = await connection.getProgramAccounts(XIVE_PROGRAM_ID, {
    filters: [
      { dataSize: POSITION_SIZE },
      { memcmp: { offset: 0, bytes: bs58.encode(POSITION_DISCRIMINATOR) } },
      { memcmp: { offset: 9, bytes: user.toBase58() } },
    ],
  });
  return accounts
    .map(({ pubkey, account }) => decode(pubkey, account.data as Buffer))
    .sort((a, b) => a.address.toBase58().localeCompare(b.address.toBase58()));
}

export async function fetchAllPositions(
  connection: Connection,
): Promise<Position[]> {
  const accounts = await connection.getProgramAccounts(XIVE_PROGRAM_ID, {
    filters: [
      { dataSize: POSITION_SIZE },
      { memcmp: { offset: 0, bytes: bs58.encode(POSITION_DISCRIMINATOR) } },
    ],
  });
  return accounts
    .map(({ pubkey, account }) => decode(pubkey, account.data as Buffer))
    .sort((a, b) => a.address.toBase58().localeCompare(b.address.toBase58()));
}
