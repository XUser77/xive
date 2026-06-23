import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN, type Wallet } from "@coral-xyz/anchor";
import {
  IGNORE_CACHE,
  PDAUtil,
  SwapUtils,
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByOutputToken,
} from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  LIQUIDATION_BONUS_BPS,
  LP_VAULT_MINT,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  VAULT_PROGRAM_ID,
  WHIRLPOOL_PROGRAM_ID,
  XIVE_PROGRAM_ID,
  XUSD_MINT,
} from "./config";
import { ata, collateralPda, vaultPda, xivePda } from "./pdas";
import { findCollateralUsdcPool, xusdUsdcPoolAddress } from "./orca";

const LIQUIDATION_SWAP_SLIPPAGE = Percentage.fromFraction(1, 100);

const DISCRIMINATOR_DEPOSIT = new Uint8Array([
  242, 35, 198, 137, 82, 225, 242, 182,
]);
const DISCRIMINATOR_WITHDRAW = new Uint8Array([
  183, 18, 70, 156, 148, 109, 161, 34,
]);
const DISCRIMINATOR_LIQUIDATE = new Uint8Array([
  223, 179, 226, 125, 48, 46, 39, 74,
]);
const DISCRIMINATOR_BUY_USDC = new Uint8Array([
  255, 72, 220, 134, 213, 71, 195, 32,
]);
const DISCRIMINATOR_BUY_XUSD = new Uint8Array([
  118, 195, 49, 186, 252, 252, 148, 84,
]);

// Swap fee in basis points — must match programs/vault/src/constants.rs::SWAP_FEE.
export const SWAP_FEE_BPS = 5n;
// Minimum swap input in base units (programs/vault: require amount >= 10 * 1000).
export const SWAP_MIN_AMOUNT = 10_000n;

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

export function vaultDepositIx(args: {
  user: PublicKey;
  /** xUSD to deposit, in base units. */
  amount: bigint;
  /** Minimum LP-xUSD shares to accept (slippage guard). Defaults to 0. */
  minLpAmount?: bigint;
}): TransactionInstruction {
  const { user, amount, minLpAmount = 0n } = args;
  const vault = vaultPda();
  const xive = xivePda();
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: xive, isSigner: false, isWritable: false },
      { pubkey: LP_VAULT_MINT, isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(vault, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(vault, USDC_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(user, LP_VAULT_MINT), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR_DEPOSIT),
      u64LE(amount),
      u64LE(minLpAmount),
    ]),
  });
}

export function vaultWithdrawIx(args: {
  user: PublicKey;
  /** LP-xUSD shares to burn, in base units. */
  lpAmount: bigint;
  /** Minimum xUSD to accept back (slippage guard). Defaults to 0. */
  minXusdAmount?: bigint;
}): TransactionInstruction {
  const { user, lpAmount, minXusdAmount = 0n } = args;
  const vault = vaultPda();
  const xive = xivePda();
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: xive, isSigner: false, isWritable: true },
      { pubkey: LP_VAULT_MINT, isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: ata(user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(vault, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(vault, USDC_MINT), isSigner: false, isWritable: false },
      { pubkey: ata(user, LP_VAULT_MINT), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: XIVE_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR_WITHDRAW),
      u64LE(lpAmount),
      u64LE(minXusdAmount),
    ]),
  });
}

// Accounts are identical for both swap directions (vault::buy_usdc / buy_xusd).
function swapKeys(swapper: PublicKey) {
  const vault = vaultPda();
  return [
    { pubkey: swapper, isSigner: true, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: XUSD_MINT, isSigner: false, isWritable: false },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: ata(vault, XUSD_MINT), isSigner: false, isWritable: true },
    { pubkey: ata(vault, USDC_MINT), isSigner: false, isWritable: true },
    { pubkey: ata(swapper, XUSD_MINT), isSigner: false, isWritable: true },
    { pubkey: ata(swapper, USDC_MINT), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

/// Swap XUSD → USDC. `amount` is the XUSD paid in (base units); the swapper
/// receives `amount − 0.05%` USDC.
export function buyUsdcIx(args: { user: PublicKey; amount: bigint }): TransactionInstruction {
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: swapKeys(args.user),
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_BUY_USDC), u64LE(args.amount)]),
  });
}

/// Swap USDC → XUSD. `amount` is the USDC paid in (base units); the swapper
/// receives `amount − 0.05%` XUSD. If the vault is short on XUSD it mints the
/// shortfall from xive (hence the extra xive / xive_program accounts).
export function buyXusdIx(args: { user: PublicKey; amount: bigint }): TransactionInstruction {
  const vault = vaultPda();
  const xive = xivePda();
  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: args.user, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: ata(vault, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(vault, USDC_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(args.user, XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: ata(args.user, USDC_MINT), isSigner: false, isWritable: true },
      { pubkey: xive, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: XIVE_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR_BUY_XUSD), u64LE(args.amount)]),
  });
}

class ReadOnlyWallet implements Wallet {
  constructor(public readonly publicKey: PublicKey) {}
  async signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
  get payer(): never {
    throw new Error("ReadOnlyWallet has no payer");
  }
}

async function prefetchTickArraysForPool(
  connection: Connection,
  pool: Awaited<ReturnType<ReturnType<typeof buildWhirlpoolClient>["getPool"]>>,
): Promise<void> {
  const data = pool.getData();
  const addr = pool.getAddress();
  // Fetch tick arrays in both swap directions to seed surfpool's account cache.
  const both = [
    ...SwapUtils.getTickArrayPublicKeys(
      data.tickCurrentIndex,
      data.tickSpacing,
      true,
      WHIRLPOOL_PROGRAM_ID,
      addr,
    ),
    ...SwapUtils.getTickArrayPublicKeys(
      data.tickCurrentIndex,
      data.tickSpacing,
      false,
      WHIRLPOOL_PROGRAM_ID,
      addr,
    ),
  ];
  const unique = Array.from(new Map(both.map((k) => [k.toBase58(), k])).values());
  await connection.getMultipleAccountsInfo(unique, "confirmed");
}

function buildReadOnlyCtx(connection: Connection, payer: PublicKey): WhirlpoolContext {
  const provider = new AnchorProvider(connection, new ReadOnlyWallet(payer), {
    commitment: "confirmed",
  });
  return WhirlpoolContext.withProvider(provider, WHIRLPOOL_PROGRAM_ID);
}

// DEPRECATED / NOT WIRED UP: the on-chain `vault::liquidate` now performs the
// collateral→USDC→xUSD swap through Jupiter (it takes `jupiter_swap_data: bytes`
// and a `jupiter_program` account), not the two Orca Whirlpool hops this builder
// constructs. This function targets the removed Orca flow and is currently unused;
// it must be rewritten against the Jupiter route API before it can be called again.
export async function buildVaultLiquidateIx(args: {
  connection: Connection;
  payer: PublicKey;
  position: PublicKey;
  collateralMint: PublicKey;
  /** Outstanding loan in XUSD base units (loan_amount). */
  debt: bigint;
}): Promise<TransactionInstruction> {
  const { connection, payer, position, collateralMint, debt } = args;
  const vault = vaultPda();
  const xive = xivePda();

  // target_xusd = debt * (10_000 + LIQUIDATION_BONUS_BPS) / 10_000  (matches programs/vault/src/instructions/liquidate.rs)
  const targetXusd = (debt * (10_000n + LIQUIDATION_BONUS_BPS)) / 10_000n;
  if (targetXusd <= 0n) throw new Error("position has no debt to liquidate");

  const poolOneAddr = await findCollateralUsdcPool(connection, collateralMint);
  const poolTwoAddr = xusdUsdcPoolAddress();

  const ctx = buildReadOnlyCtx(connection, payer);
  const client = buildWhirlpoolClient(ctx);
  // IGNORE_CACHE — the SDK fetcher caches pool data across calls, and a stale `liquidity: 0`
  // (from when the pool was first opened with no LP) silently corrupts the swap quote.
  const [poolOne, poolTwo] = await Promise.all([
    client.getPool(poolOneAddr, IGNORE_CACHE),
    client.getPool(poolTwoAddr, IGNORE_CACHE),
  ]);

  // Surfpool lazily clones mainnet accounts on first read. The SDK's batch fetcher caches null
  // results, so if tick arrays haven't been touched yet we'd quote against an empty sequence and
  // walk past available liquidity. Force-fetch each candidate tick array first to seed the clone.
  await prefetchTickArraysForPool(connection, poolOne);
  await prefetchTickArraysForPool(connection, poolTwo);

  // Walk the swap chain backwards: pool 2 (USDC -> XUSD) determines the USDC needed,
  // which becomes pool 1's exact-output target (collateral -> USDC).
  const poolOneData = poolOne.getData();
  const poolTwoData = poolTwo.getData();
  console.log("[liquidate] target_xusd (raw):", targetXusd.toString());
  console.log("[liquidate] pool2 (XUSD/USDC):", {
    address: poolTwoAddr.toBase58(),
    tickCurrentIndex: poolTwoData.tickCurrentIndex,
    tickSpacing: poolTwoData.tickSpacing,
    liquidity: poolTwoData.liquidity.toString(),
    sqrtPrice: poolTwoData.sqrtPrice.toString(),
    mintA: poolTwoData.tokenMintA.toBase58(),
    mintB: poolTwoData.tokenMintB.toBase58(),
  });
  console.log("[liquidate] pool1 (collateral/USDC):", {
    address: poolOneAddr.toBase58(),
    tickCurrentIndex: poolOneData.tickCurrentIndex,
    tickSpacing: poolOneData.tickSpacing,
    liquidity: poolOneData.liquidity.toString(),
    sqrtPrice: poolOneData.sqrtPrice.toString(),
    mintA: poolOneData.tokenMintA.toBase58(),
    mintB: poolOneData.tokenMintB.toBase58(),
  });
  const quoteTwo = await swapQuoteByOutputToken(
    poolTwo,
    XUSD_MINT,
    new BN(targetXusd.toString()),
    LIQUIDATION_SWAP_SLIPPAGE,
    WHIRLPOOL_PROGRAM_ID,
    ctx.fetcher,
    IGNORE_CACHE,
  ).catch((e) => {
    throw new Error(`pool 2 (XUSD/USDC) quote failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  console.log("[liquidate] quoteTwo:", {
    aToB: quoteTwo.aToB,
    estimatedAmountIn: quoteTwo.estimatedAmountIn.toString(),
    estimatedAmountOut: quoteTwo.estimatedAmountOut.toString(),
    estimatedEndTickIndex: quoteTwo.estimatedEndTickIndex,
    tickArrays: [quoteTwo.tickArray0.toBase58(), quoteTwo.tickArray1.toBase58(), quoteTwo.tickArray2.toBase58()],
  });
  const quoteOne = await swapQuoteByOutputToken(
    poolOne,
    USDC_MINT,
    quoteTwo.estimatedAmountIn,
    LIQUIDATION_SWAP_SLIPPAGE,
    WHIRLPOOL_PROGRAM_ID,
    ctx.fetcher,
    IGNORE_CACHE,
  ).catch((e) => {
    throw new Error(`pool 1 (collateral/USDC) quote failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  console.log("[liquidate] quoteOne:", {
    aToB: quoteOne.aToB,
    estimatedAmountIn: quoteOne.estimatedAmountIn.toString(),
    estimatedAmountOut: quoteOne.estimatedAmountOut.toString(),
  });

  const oracleOne = PDAUtil.getOracle(WHIRLPOOL_PROGRAM_ID, poolOneAddr).publicKey;
  const oracleTwo = PDAUtil.getOracle(WHIRLPOOL_PROGRAM_ID, poolTwoAddr).publicKey;

  const vaultAtaFor = (mint: PublicKey) => ata(vault, mint);

  const data = Buffer.concat([
    Buffer.from(DISCRIMINATOR_LIQUIDATE),
    Buffer.from([quoteOne.aToB ? 1 : 0, quoteTwo.aToB ? 1 : 0]),
  ]);

  return new TransactionInstruction({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: XIVE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: xive, isSigner: false, isWritable: true },
      { pubkey: collateralPda(collateralMint), isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: XUSD_MINT, isSigner: false, isWritable: true },
      { pubkey: vaultAtaFor(XUSD_MINT), isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: vaultAtaFor(collateralMint), isSigner: false, isWritable: true },
      { pubkey: ata(xive, collateralMint), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: vaultAtaFor(USDC_MINT), isSigner: false, isWritable: true },
      { pubkey: WHIRLPOOL_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: poolOneAddr, isSigner: false, isWritable: true },
      { pubkey: poolTwoAddr, isSigner: false, isWritable: true },
      { pubkey: vaultAtaFor(poolOneData.tokenMintA), isSigner: false, isWritable: true },
      { pubkey: poolOneData.tokenVaultA, isSigner: false, isWritable: true },
      { pubkey: vaultAtaFor(poolOneData.tokenMintB), isSigner: false, isWritable: true },
      { pubkey: poolOneData.tokenVaultB, isSigner: false, isWritable: true },
      { pubkey: vaultAtaFor(poolTwoData.tokenMintA), isSigner: false, isWritable: true },
      { pubkey: poolTwoData.tokenVaultA, isSigner: false, isWritable: true },
      { pubkey: vaultAtaFor(poolTwoData.tokenMintB), isSigner: false, isWritable: true },
      { pubkey: poolTwoData.tokenVaultB, isSigner: false, isWritable: true },
      { pubkey: quoteOne.tickArray0, isSigner: false, isWritable: true },
      { pubkey: quoteOne.tickArray1, isSigner: false, isWritable: true },
      { pubkey: quoteOne.tickArray2, isSigner: false, isWritable: true },
      { pubkey: quoteTwo.tickArray0, isSigner: false, isWritable: true },
      { pubkey: quoteTwo.tickArray1, isSigner: false, isWritable: true },
      { pubkey: quoteTwo.tickArray2, isSigner: false, isWritable: true },
      { pubkey: oracleOne, isSigner: false, isWritable: false },
      { pubkey: oracleTwo, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}
