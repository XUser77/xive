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
