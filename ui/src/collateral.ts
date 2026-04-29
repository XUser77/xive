import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { COLLATERALS_PROGRAM_ID } from "./config";

const COLLATERAL_DISCRIMINATOR = new Uint8Array([
  123, 130, 234, 63, 255, 240, 255, 92,
]);

const COLLATERAL_SIZE = 8 + 32 + 1 + 8 + 8 + 1 + 8 + 8;

export type Collateral = {
  address: PublicKey;
  mint: PublicKey;
  bump: number;
  ltv: bigint;
  liquidationLtv: bigint;
  allowed: boolean;
  price: bigint;
  priceDate: bigint;
};

function decodeCollateral(address: PublicKey, data: Buffer): Collateral {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8; // skip discriminator

  const mint = new PublicKey(data.subarray(o, o + 32));
  o += 32;

  const bump = view.getUint8(o);
  o += 1;

  const ltv = view.getBigUint64(o, true);
  o += 8;

  const liquidationLtv = view.getBigUint64(o, true);
  o += 8;

  const allowed = view.getUint8(o) !== 0;
  o += 1;

  const price = view.getBigUint64(o, true);
  o += 8;

  const priceDate = view.getBigInt64(o, true);
  o += 8;

  return { address, mint, bump, ltv, liquidationLtv, allowed, price, priceDate };
}

export async function fetchCollaterals(
  connection: Connection,
): Promise<Collateral[]> {
  const accounts = await connection.getProgramAccounts(COLLATERALS_PROGRAM_ID, {
    filters: [
      { dataSize: COLLATERAL_SIZE },
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(COLLATERAL_DISCRIMINATOR),
        },
      },
    ],
  });

  return accounts
    .map(({ pubkey, account }) =>
      decodeCollateral(pubkey, account.data as Buffer),
    )
    .sort((a, b) => a.mint.toBase58().localeCompare(b.mint.toBase58()));
}
