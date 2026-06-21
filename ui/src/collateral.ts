import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { XIVE_PROGRAM_ID } from "./config";

/// Collateral prices are pushed on-chain as 6-decimal USD values, matching the
/// xUSD mint decimals (see `programs/xive/src/utils.rs::get_position_bps`).
export const PRICE_DECIMALS = 6;
export const PRICE_SCALE = 10 ** PRICE_DECIMALS;

/// Convert raw 6-decimal price to a JS number (floating-point dollars).
/// Safe for any price under ~$9e9 — well outside any real asset.
export function priceToUsd(price: bigint): number {
  return Number(price) / PRICE_SCALE;
}

/// Convert a user-typed dollar amount (possibly fractional) to the raw
/// 6-decimal representation expected on chain.
export function usdToPrice(usd: number): bigint {
  return BigInt(Math.round(usd * PRICE_SCALE));
}

// `Collateral` account discriminator — must match target/idl/xive.json.
const COLLATERAL_DISCRIMINATOR = new Uint8Array([
  123, 130, 234, 63, 255, 240, 255, 92,
]);

// discriminator(8) + bump(1) + mint(32) + enabled(1) + ltv(u16) +
// liquidation_ltv(u16) + price(u64) + price_date(i64)
const COLLATERAL_SIZE = 8 + 1 + 32 + 1 + 2 + 2 + 8 + 8;

export type Collateral = {
  address: PublicKey;
  mint: PublicKey;
  bump: number;
  ltv: bigint; // basis points
  liquidationLtv: bigint; // basis points
  allowed: boolean;
  price: bigint;
  priceDate: bigint;
};

function decodeCollateral(address: PublicKey, data: Buffer): Collateral {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8; // skip discriminator

  const bump = view.getUint8(o);
  o += 1;

  const mint = new PublicKey(data.subarray(o, o + 32));
  o += 32;

  const allowed = view.getUint8(o) !== 0;
  o += 1;

  const ltv = BigInt(view.getUint16(o, true));
  o += 2;

  const liquidationLtv = BigInt(view.getUint16(o, true));
  o += 2;

  const price = view.getBigUint64(o, true);
  o += 8;

  const priceDate = view.getBigInt64(o, true);
  o += 8;

  return { address, mint, bump, ltv, liquidationLtv, allowed, price, priceDate };
}

export async function fetchCollaterals(
  connection: Connection,
): Promise<Collateral[]> {
  const accounts = await connection.getProgramAccounts(XIVE_PROGRAM_ID, {
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
