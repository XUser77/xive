import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  IGNORE_CACHE,
  WhirlpoolContext,
  buildWhirlpoolClient,
  PDAUtil,
  type WhirlpoolClient,
  type Whirlpool,
} from "@orca-so/whirlpools-sdk";

import {
  STABLE_TICK_SPACING,
  USDC_MINT,
  WHIRLPOOL_PROGRAM_ID,
  WHIRLPOOLS_CONFIG,
  XUSD_MINT,
} from "./config";

export type SignTx = <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
export type SignAll = <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;

class AdapterWallet implements Wallet {
  constructor(
    private readonly pk: PublicKey,
    private readonly signTx: SignTx,
    private readonly signAll: SignAll,
  ) {}
  get publicKey() {
    return this.pk;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    return this.signTx(tx);
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return this.signAll(txs);
  }
  get payer(): never {
    throw new Error("AdapterWallet has no payer keypair");
  }
}

export function buildClient(
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: SignTx,
  signAllTransactions: SignAll,
): { client: WhirlpoolClient; ctx: WhirlpoolContext } {
  const wallet = new AdapterWallet(publicKey, signTransaction, signAllTransactions);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const ctx = WhirlpoolContext.withProvider(provider, WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);
  return { client, ctx };
}

/** Orders mints so tokenA < tokenB (Orca canonical order). */
export function orderMints(x: PublicKey, y: PublicKey): [PublicKey, PublicKey] {
  return x.toBuffer().compare(y.toBuffer()) < 0 ? [x, y] : [y, x];
}

export function xusdUsdcPoolAddress(): PublicKey {
  const [a, b] = orderMints(XUSD_MINT, USDC_MINT);
  return PDAUtil.getWhirlpool(WHIRLPOOL_PROGRAM_ID, WHIRLPOOLS_CONFIG, a, b, STABLE_TICK_SPACING)
    .publicKey;
}

export async function getXusdUsdcPool(client: WhirlpoolClient): Promise<Whirlpool> {
  // IGNORE_CACHE — pool state changes after every LP add/swap; stale `liquidity: 0`
  // from a fresh-pool fetch silently breaks downstream quotes.
  return client.getPool(xusdUsdcPoolAddress(), IGNORE_CACHE);
}

const COLLATERAL_POOL_TICK_SPACINGS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/**
 * Returns the most-liquid Orca pool for `collateral`/USDC across all tick spacings.
 * Multiple pools usually exist for the same pair at different fee tiers — picking
 * the deepest one keeps liquidations from blowing through the 3-tick-array limit
 * of the on-chain TwoHopSwap.
 */
export async function findCollateralUsdcPool(
  connection: Connection,
  collateralMint: PublicKey,
): Promise<PublicKey> {
  const [a, b] = orderMints(collateralMint, USDC_MINT);
  const candidates = COLLATERAL_POOL_TICK_SPACINGS.map((ts) =>
    PDAUtil.getWhirlpool(WHIRLPOOL_PROGRAM_ID, WHIRLPOOLS_CONFIG, a, b, ts).publicKey,
  );
  const infos = await connection.getMultipleAccountsInfo(candidates, "confirmed");

  // Whirlpool layout: 8-byte discriminator + 32 (config) + 1 (bump) + 2 (tickSpacing)
  // + 2 (tickSpacingSeed) + 2 (feeRate) + 2 (protocolFeeRate) + 16 (liquidity u128 LE) + ...
  const LIQUIDITY_OFFSET = 8 + 32 + 1 + 2 + 2 + 2 + 2;

  let best: { pda: PublicKey; liquidity: bigint } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const info = infos[i];
    if (!info || !info.owner.equals(WHIRLPOOL_PROGRAM_ID)) continue;
    const liqLE = info.data.subarray(LIQUIDITY_OFFSET, LIQUIDITY_OFFSET + 16);
    // u128 little-endian → BigInt
    let liquidity = 0n;
    for (let j = 15; j >= 0; j--) liquidity = (liquidity << 8n) | BigInt(liqLE[j]);
    if (!best || liquidity > best.liquidity) {
      best = { pda: candidates[i], liquidity };
    }
  }
  if (!best) throw new Error(`no Orca pool found for ${collateralMint.toBase58()}/USDC`);
  return best.pda;
}
