/**
 * End-to-end test for `xive::withdraw_fees`.
 *
 *   1. fund a fresh user (SOL + WETH + USDC)
 *   2. createUserState + openPosition → fee accumulates in xive's XUSD ATA
 *   3. seed the XUSD/USDC Orca pool with liquidity in the [-100, 100] tick range
 *   4. xive.init_lp_position — opens xive's own LP NFT in that same range
 *   5. xive.withdraw_fees — verifies team gets 80%, LP gets the remaining 20%
 *      (half-swapped to USDC, then deposited into xive's LP position)
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

import type { Xive } from "../target/types/xive.js";
import { rpcCall } from "./utils.js";

const XIVE_PROGRAM_ID = new PublicKey("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");
const TEAM_PROGRAM_ID = new PublicKey("GY9r4oMpnsQyw8xgi6ZNv68vuCB1gNA1cRCZjTn5aH7g");
const XUSD_MINT = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");

// Mirrors programs/xive/src/instructions/init_lp_position.rs
const LP_TICK_LOWER = -100;
const LP_TICK_UPPER = 100;
const STABLE_TICK_SPACING = 1;

// Mirrors programs/xive/src/constants.rs::TEAM_FEE_SHARE_BPS
const TEAM_FEE_SHARE_BPS = 8_000n;
// Mirrors DEFAULT_COMMISSION_BPS — 0.5% borrow fee.
const COMMISSION_BPS = 50n;

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

function xivePda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("xive")], XIVE_PROGRAM_ID)[0];
}

function teamPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("team")], TEAM_PROGRAM_ID)[0];
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

describe("xive — withdraw_fees", () => {
  let provider: AnchorProvider;
  let connection: anchor.web3.Connection;
  let xiveProgram: Program<Xive>;
  let user: Keypair;
  let lpPositionMint: Keypair;

  // Borrow 10 000 XUSD → fee = 50 XUSD = 50_000_000 raw lands in xive_xusd_ata.
  const BORROW_RAW = 10_000_000_000n;
  const COLLATERAL_RAW = 1_000_000_000n; // 10 WETH (8 decimals)
  const ACCRUED_FEE_RAW = (BORROW_RAW * COMMISSION_BPS) / 10_000n;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    connection = provider.connection;
    xiveProgram = anchor.workspace.xive as Program<Xive>;
    user = Keypair.generate();
    lpPositionMint = Keypair.generate();
  });

  it("funds the user", async () => {
    await rpcCall("surfnet_setAccount", [
      user.publicKey.toBase58(),
      { lamports: 100_000_000_000 },
    ]);
    await rpcCall("surfnet_setTokenAccount", [
      user.publicKey.toBase58(),
      WETH_MINT.toBase58(),
      { amount: 10_000_000_000 }, // 100 WETH
    ]);
    await rpcCall("surfnet_setTokenAccount", [
      user.publicKey.toBase58(),
      USDC_MINT.toBase58(),
      { amount: 10_000_000_000 }, // 10 000 USDC
    ]);
  });

  it("creates user state and accumulates fees by borrowing", async () => {
    await xiveProgram.methods
      .createUserState()
      .accounts({ user: user.publicKey })
      .signers([user])
      .rpc();

    await xiveProgram.methods
      .openPosition(new BN(COLLATERAL_RAW.toString()), new BN(BORROW_RAW.toString()))
      .accounts({
        user: user.publicKey,
        collateralMint: WETH_MINT,
      })
      .signers([user])
      .rpc();

    const xiveXusd = await connection.getTokenAccountBalance(ata(xivePda(), XUSD_MINT));
    expect(xiveXusd.value.amount).to.equal(ACCRUED_FEE_RAW.toString());
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

    // Init every tick array the swap or LP add can touch:
    //   - LP_TICK_LOWER / LP_TICK_UPPER → withdraw_fees increase_liquidity leg
    //   - aligned, aligned - 88 → withdraw_fees swap leg (XUSD→USDC walks down)
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

  it("init_lp_position — opens xive's LP position NFT", async () => {
    const xive = xivePda();
    const positionPda = PDAUtil.getPosition(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      lpPositionMint.publicKey,
    ).publicKey;
    const positionTokenAccount = ata(xive, lpPositionMint.publicKey);

    await xiveProgram.methods
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

    const xiveAccount = await xiveProgram.account.xive.fetch(xive);
    expect(xiveAccount.lpPositionMint.toBase58()).to.equal(lpPositionMint.publicKey.toBase58());
    expect(xiveAccount.lpWhirlpool.toBase58()).to.equal(xusdUsdcPoolAddress().toBase58());
  });

  it("withdraw_fees — sends 80% to team, deposits 20% into LP", async () => {
    const xive = xivePda();
    const team = teamPda();
    const teamXusdAta = ata(team, XUSD_MINT);
    const xiveXusdAta = ata(xive, XUSD_MINT);
    const xiveUsdcAta = ata(xive, USDC_MINT);

    const totalRaw = BigInt(
      (await connection.getTokenAccountBalance(xiveXusdAta)).value.amount,
    );
    expect(totalRaw).to.equal(ACCRUED_FEE_RAW);
    const expectedTeam = (totalRaw * TEAM_FEE_SHARE_BPS) / 10_000n;
    const lpSlice = totalRaw - expectedTeam;
    const swapAmount = lpSlice / 2n;

    const wallet = new Wallet(user);
    const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
    const client = buildWhirlpoolClient(ctx);
    const pool = await client.getPool(xusdUsdcPoolAddress(), IGNORE_CACHE);
    const poolData = pool.getData();

    // Quote so we can grab the three tick arrays the swap needs (XUSD→USDC, exact in).
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

    const ix = await xiveProgram.methods
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

    // The swap + increase_liquidity CPIs blow past the default 200k CU budget.
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ix);
    const sig = await provider.sendAndConfirm(tx, [user]);
    console.log("[withdraw_fees-test] tx sig:", sig);

    const teamBal = await connection.getTokenAccountBalance(teamXusdAta);
    expect(teamBal.value.amount).to.equal(expectedTeam.toString());

    // After the LP add, xive's XUSD ATA should hold less than the LP slice — the
    // increase_liquidity CPI consumes whatever the position needs (a fraction of
    // lp_xusd_amount = lpSlice - swapAmount). USDC ATA leftover follows the same logic.
    const xiveXusdAfter = BigInt(
      (await connection.getTokenAccountBalance(xiveXusdAta)).value.amount,
    );
    expect(xiveXusdAfter).to.be.lessThan(totalRaw - expectedTeam);

    const xiveUsdcInfo = await connection.getAccountInfo(xiveUsdcAta);
    expect(xiveUsdcInfo).to.not.equal(null);
  });
});
