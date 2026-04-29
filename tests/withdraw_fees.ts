/**
 * End-to-end test for `fees::withdraw_fees`.
 *
 *   1. fund a fresh user (SOL + WETH + USDC)
 *   2. createUserState + openPosition → fee accumulates in the **fees** PDA's XUSD ATA
 *   3. seed the XUSD/USDC Orca pool with liquidity in the [-100, 100] tick range
 *   4. fees.init_lp_position — opens fees' own LP NFT in that same range
 *   5. fees.withdraw_fees — verifies team gets 80%, LP gets the remaining 20%
 *      (half-swapped to USDC, then deposited into fees' LP position)
 */
import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  IGNORE_CACHE,
  NO_TOKEN_EXTENSION_CONTEXT,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG,
  PDAUtil,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputToken,
  swapQuoteByInputToken,
} from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import { expect } from "chai";

import type { Collaterals } from "../target/types/collaterals.js";
import type { Fees as FeesIdl } from "../target/types/fees.js";
import type { Xive } from "../target/types/xive.js";
import { rpcCall } from "./utils.js";

const XIVE_PROGRAM_ID = new PublicKey("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");
const FEES_PROGRAM_ID = new PublicKey("893XCpv5JsEmLEQvXE7wJ3k7idUBNVKQ5URDHVigchmU");
const TEAM_PROGRAM_ID = new PublicKey("GY9r4oMpnsQyw8xgi6ZNv68vuCB1gNA1cRCZjTn5aH7g");
const COLLATERALS_PROGRAM_ID = new PublicKey("HmMqUcvc8WJAaFWafJNwEHGakhegGSzZeqsGcE8NCucx");
const XUSD_MINT = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");

// Mirrors programs/fees/src/instructions/init_lp_position.rs
const LP_TICK_LOWER = -100;
const LP_TICK_UPPER = 100;
const STABLE_TICK_SPACING = 1;

// Mirrors programs/fees/src/constants.rs::TEAM_FEE_SHARE_BPS
const TEAM_FEE_SHARE_BPS = 8_000n;
// Mirrors xive's DEFAULT_COMMISSION_BPS — 0.5% borrow fee.
const COMMISSION_BPS = 50n;

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

function feesPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("fees")], FEES_PROGRAM_ID)[0];
}

function teamPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("team")], TEAM_PROGRAM_ID)[0];
}

function collateralPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), mint.toBuffer()],
    COLLATERALS_PROGRAM_ID,
  )[0];
}

async function tokenBalance(connection: anchor.web3.Connection, addr: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(addr);
  if (!info) return 0n;
  const bal = await connection.getTokenAccountBalance(addr);
  return BigInt(bal.value.amount);
}

function orderMints(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return a.toBuffer().compare(b.toBuffer()) < 0 ? [a, b] : [b, a];
}

function xusdUsdcPoolAddress(): PublicKey {
  const [a, b] = orderMints(XUSD_MINT, USDC_MINT);
  return PDAUtil.getWhirlpool(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ORCA_WHIRLPOOLS_CONFIG,
    a,
    b,
    STABLE_TICK_SPACING,
  ).publicKey;
}

describe("fees — withdraw_fees", () => {
  let provider: AnchorProvider;
  let connection: anchor.web3.Connection;
  let xiveProgram: Program<Xive>;
  let feesProgram: Program<FeesIdl>;
  let collateralsProgram: Program<Collaterals>;
  let user: Keypair;
  let lpPositionMint: Keypair;
  // Snapshots for delta-based assertions — fees ATA and team ATA are global state
  // that may carry balances from previous test files.
  let feesXusdBefore: bigint;

  // Borrow 10 000 XUSD → fee = 50 XUSD = 50_000_000 raw lands in fees_xusd_ata.
  const BORROW_RAW = 10_000_000_000n;
  const COLLATERAL_RAW = 1_000_000_000n;
  const ACCRUED_FEE_RAW = (BORROW_RAW * COMMISSION_BPS) / 10_000n;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    connection = provider.connection;
    xiveProgram = anchor.workspace.xive as Program<Xive>;
    feesProgram = anchor.workspace.fees as Program<FeesIdl>;
    collateralsProgram = anchor.workspace.collaterals as Program<Collaterals>;
    user = Keypair.generate();
    lpPositionMint = Keypair.generate();

    // Reset WETH price — earlier suites may have moved it. We need a funded signer
    // for set_price, so the user gets SOL up front (full token funding happens later).
    await rpcCall("surfnet_setAccount", [
      user.publicKey.toBase58(),
      { lamports: 100_000_000_000 },
    ]);
    await collateralsProgram.methods
      .setPrice(new BN(3000))
      .accounts({
        payer: user.publicKey,
        collateral: collateralPda(WETH_MINT),
      } as never)
      .signers([user])
      .rpc();
  });

  it("funds the user", async () => {
    await rpcCall("surfnet_setAccount", [
      user.publicKey.toBase58(),
      { lamports: 100_000_000_000 },
    ]);
    await rpcCall("surfnet_setTokenAccount", [
      user.publicKey.toBase58(),
      WETH_MINT.toBase58(),
      { amount: 10_000_000_000 },
    ]);
    await rpcCall("surfnet_setTokenAccount", [
      user.publicKey.toBase58(),
      USDC_MINT.toBase58(),
      { amount: 10_000_000_000 },
    ]);
  });

  it("creates user state and accumulates fees by borrowing", async () => {
    await xiveProgram.methods
      .createUserState()
      .accounts({ user: user.publicKey })
      .signers([user])
      .rpc();

    feesXusdBefore = await tokenBalance(connection, ata(feesPda(), XUSD_MINT));

    await xiveProgram.methods
      .openPosition(new BN(COLLATERAL_RAW.toString()), new BN(BORROW_RAW.toString()))
      .accounts({
        user: user.publicKey,
        collateralMint: WETH_MINT,
      })
      .signers([user])
      .rpc();

    const feesXusdAfter = await tokenBalance(connection, ata(feesPda(), XUSD_MINT));
    expect(feesXusdAfter - feesXusdBefore).to.equal(ACCRUED_FEE_RAW);
  });

  it("seeds the XUSD/USDC pool with liquidity around the LP range", async () => {
    const wallet = new Wallet(user);
    const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
    const client = buildWhirlpoolClient(ctx);
    const pool = await client.getPool(xusdUsdcPoolAddress());

    const data = pool.getData();
    const tickSpacing = data.tickSpacing;
    const aligned = Math.floor(data.tickCurrentIndex / tickSpacing) * tickSpacing;

    const quote = increaseLiquidityQuoteByInputToken(
      USDC_MINT,
      new Decimal("1000"),
      LP_TICK_LOWER,
      LP_TICK_UPPER,
      Percentage.fromFraction(1, 100),
      pool,
      NO_TOKEN_EXTENSION_CONTEXT,
    );
    const { tx } = await pool.openPositionWithMetadata(LP_TICK_LOWER, LP_TICK_UPPER, quote);

    const startTicks = new Set<number>(
      [LP_TICK_LOWER, LP_TICK_UPPER, aligned, aligned - 88].map((t) =>
        TickUtil.getStartTickIndex(t, tickSpacing),
      ),
    );
    for (const startTick of startTicks) {
      const tickArrayPda = PDAUtil.getTickArray(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        pool.getAddress(),
        startTick,
      );
      const info = await connection.getAccountInfo(tickArrayPda.publicKey);
      if (info) continue;
      tx.prependInstruction(
        WhirlpoolIx.initTickArrayIx(ctx.program, {
          whirlpool: pool.getAddress(),
          tickArrayPda,
          startTick,
          funder: user.publicKey,
        }),
      );
    }

    await tx.buildAndExecute();

    const refreshed = await client.getPool(xusdUsdcPoolAddress(), IGNORE_CACHE);
    expect(refreshed.getData().liquidity.gt(new BN(0))).to.equal(true);
  });

  it("init_lp_position — opens fees' LP position NFT", async () => {
    const fees = feesPda();
    const positionPda = PDAUtil.getPosition(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      lpPositionMint.publicKey,
    ).publicKey;
    const positionTokenAccount = ata(fees, lpPositionMint.publicKey);

    await feesProgram.methods
      .initLpPosition()
      .accounts({
        funder: user.publicKey,
        whirlpool: xusdUsdcPoolAddress(),
        positionMint: lpPositionMint.publicKey,
        position: positionPda,
        positionTokenAccount,
        whirlpoolProgram: ORCA_WHIRLPOOL_PROGRAM_ID,
      } as never)
      .signers([user, lpPositionMint])
      .rpc();

    const feesAccount = await feesProgram.account.fees.fetch(fees);
    expect(feesAccount.lpPositionMint.toBase58()).to.equal(lpPositionMint.publicKey.toBase58());
    expect(feesAccount.lpWhirlpool.toBase58()).to.equal(xusdUsdcPoolAddress().toBase58());
  });

  it("withdraw_fees — sends 80% to team, deposits 20% into LP", async () => {
    const fees = feesPda();
    const team = teamPda();
    const teamXusdAta = ata(team, XUSD_MINT);
    const feesXusdAta = ata(fees, XUSD_MINT);
    const feesUsdcAta = ata(fees, USDC_MINT);

    // Pre-existing balances from earlier suites: assert this run's deltas, not absolutes.
    const totalRaw = await tokenBalance(connection, feesXusdAta);
    expect(totalRaw - feesXusdBefore).to.equal(ACCRUED_FEE_RAW);
    const teamBefore = await tokenBalance(connection, teamXusdAta);
    const expectedTeam = (totalRaw * TEAM_FEE_SHARE_BPS) / 10_000n;
    const lpSlice = totalRaw - expectedTeam;
    const swapAmount = lpSlice / 2n;

    const wallet = new Wallet(user);
    const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
    const client = buildWhirlpoolClient(ctx);
    const pool = await client.getPool(xusdUsdcPoolAddress(), IGNORE_CACHE);
    const poolData = pool.getData();

    const swapQuote = await swapQuoteByInputToken(
      pool,
      XUSD_MINT,
      new BN(swapAmount.toString()),
      Percentage.fromFraction(1, 100),
      ORCA_WHIRLPOOL_PROGRAM_ID,
      ctx.fetcher,
      IGNORE_CACHE,
    );

    const oraclePda = PDAUtil.getOracle(ORCA_WHIRLPOOL_PROGRAM_ID, pool.getAddress()).publicKey;
    const lpPositionPda = PDAUtil.getPosition(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      lpPositionMint.publicKey,
    ).publicKey;
    const lpTickArrayLower = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool.getAddress(),
      TickUtil.getStartTickIndex(LP_TICK_LOWER, poolData.tickSpacing),
    ).publicKey;
    const lpTickArrayUpper = PDAUtil.getTickArray(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      pool.getAddress(),
      TickUtil.getStartTickIndex(LP_TICK_UPPER, poolData.tickSpacing),
    ).publicKey;

    const ix = await feesProgram.methods
      .withdrawFees()
      .accounts({
        payer: user.publicKey,
        xusdMint: XUSD_MINT,
        usdcMint: USDC_MINT,
        whirlpool: pool.getAddress(),
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArraySwap0: swapQuote.tickArray0,
        tickArraySwap1: swapQuote.tickArray1,
        tickArraySwap2: swapQuote.tickArray2,
        oracle: oraclePda,
        lpPosition: lpPositionPda,
        lpPositionMint: lpPositionMint.publicKey,
        lpTickArrayLower,
        lpTickArrayUpper,
        whirlpoolProgram: ORCA_WHIRLPOOL_PROGRAM_ID,
      } as never)
      .instruction();

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ix);
    const sig = await provider.sendAndConfirm(tx, [user]);
    console.log("[withdraw_fees-test] tx sig:", sig);

    const teamAfter = await tokenBalance(connection, teamXusdAta);
    expect(teamAfter - teamBefore).to.equal(expectedTeam);

    const feesXusdAfter = await tokenBalance(connection, feesXusdAta);
    // After the swap+LP add, what's left in fees XUSD must be strictly less than the
    // post-team balance (some XUSD was consumed by the swap leg, the rest by the LP).
    // chai's `.lessThan` rejects bigint, so do the comparison in plain JS.
    expect(feesXusdAfter < totalRaw - expectedTeam).to.equal(true);

    const feesUsdcInfo = await connection.getAccountInfo(feesUsdcAta);
    expect(feesUsdcInfo).to.not.equal(null);
  });
});
