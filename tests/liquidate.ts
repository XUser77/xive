/**
 * Reproducer for the vault.liquidate two-hop swap failure.
 *
 * Walks a single fresh user through:
 *   1. funding (WETH + USDC + SOL via surfnet)
 *   2. xive.create_user_state
 *   3. opens a "funding" position to mint a large XUSD bag
 *   4. vault.deposit (so vault has XUSD to burn during liquidation)
 *   5. adds liquidity to the XUSD/USDC Orca pool
 *   6. opens a small "victim" position
 *   7. drops the WETH price so the victim is liquidatable
 *   8. vault.liquidate — final test, reproduces the bug
 */
import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
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
  swapQuoteByOutputToken,
} from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import { expect } from "chai";

import type { Collaterals } from "../target/types/collaterals.js";
import type { Vault } from "../target/types/vault.js";
import type { Xive } from "../target/types/xive.js";
import { rpcCall } from "./utils.js";

// ---------- constants (mirror programs/* and ui/src/config.ts) ----------
const XIVE_PROGRAM_ID = new PublicKey("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");
const VAULT_PROGRAM_ID = new PublicKey("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");
const COLLATERALS_PROGRAM_ID = new PublicKey("HmMqUcvc8WJAaFWafJNwEHGakhegGSzZeqsGcE8NCucx");
const XUSD_MINT = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
const LP_VAULT_MINT = new PublicKey("xLPy37ThnjtANeeiqR9N2YmjK4q7T8zFNfQteFZ5PCm");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");

const STABLE_TICK_SPACING = 1;
const LP_RANGE_TICKS = 100;
const LIQUIDATION_BONUS_BPS = 500n; // matches programs/vault/src/constants.rs
const LIQUIDATION_DISCRIMINATOR = Buffer.from([223, 179, 226, 125, 48, 46, 39, 74]);

// ---------- helpers ----------
function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

function vaultPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], VAULT_PROGRAM_ID)[0];
}

function xivePda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("xive")], XIVE_PROGRAM_ID)[0];
}

function collateralPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), mint.toBuffer()],
    COLLATERALS_PROGRAM_ID,
  )[0];
}

function positionPda(user: PublicKey, counter: bigint): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(counter);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), buf],
    XIVE_PROGRAM_ID,
  )[0];
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

const COLLATERAL_TICK_SPACINGS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/** Picks the most-liquid Orca pool across all tick spacings for `mint`/USDC. */
async function findCollateralUsdcPool(
  connection: anchor.web3.Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const [a, b] = orderMints(mint, USDC_MINT);
  const candidates = COLLATERAL_TICK_SPACINGS.map(
    (ts) => PDAUtil.getWhirlpool(ORCA_WHIRLPOOL_PROGRAM_ID, ORCA_WHIRLPOOLS_CONFIG, a, b, ts).publicKey,
  );
  const infos = await connection.getMultipleAccountsInfo(candidates, "confirmed");
  // Whirlpool layout — same offset as ui/src/orca.ts.
  const LIQUIDITY_OFFSET = 8 + 32 + 1 + 2 + 2 + 2 + 2;
  let best: { pda: PublicKey; liquidity: bigint } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const info = infos[i];
    if (!info || !info.owner.equals(ORCA_WHIRLPOOL_PROGRAM_ID)) continue;
    const liqLE = info.data.subarray(LIQUIDITY_OFFSET, LIQUIDITY_OFFSET + 16);
    let liquidity = 0n;
    for (let j = 15; j >= 0; j--) liquidity = (liquidity << 8n) | BigInt(liqLE[j]);
    if (!best || liquidity > best.liquidity) best = { pda: candidates[i], liquidity };
  }
  if (!best) throw new Error(`no Orca pool found for ${mint.toBase58()}/USDC`);
  return best.pda;
}

// ---------- vault.liquidate ix builder (mirrors ui/src/vaultInstructions.ts) ----------
async function buildVaultLiquidateIx(args: {
  connection: anchor.web3.Connection;
  payer: PublicKey;
  position: PublicKey;
  collateralMint: PublicKey;
  debt: bigint;
}): Promise<TransactionInstruction> {
  const { connection, payer, position, collateralMint, debt } = args;
  const vault = vaultPda();
  const xive = xivePda();

  const targetXusd = (debt * (10_000n + LIQUIDATION_BONUS_BPS)) / 10_000n;
  if (targetXusd <= 0n) throw new Error("position has no debt");

  const poolOneAddr = await findCollateralUsdcPool(connection, collateralMint);
  const poolTwoAddr = xusdUsdcPoolAddress();

  const ctx = WhirlpoolContext.from(
    connection,
    new Wallet(Keypair.generate()), // read-only — we only use it for fetching/quoting
    ORCA_WHIRLPOOL_PROGRAM_ID,
  );
  const client = buildWhirlpoolClient(ctx);
  // IGNORE_CACHE — fetcher caches pool data and a stale `liquidity: 0` would corrupt the quote.
  const [poolOne, poolTwo] = await Promise.all([
    client.getPool(poolOneAddr, IGNORE_CACHE),
    client.getPool(poolTwoAddr, IGNORE_CACHE),
  ]);

  const poolOneData = poolOne.getData();
  const poolTwoData = poolTwo.getData();
  console.log("[liquidate] target_xusd:", targetXusd.toString());
  console.log("[liquidate] pool2 (XUSD/USDC):", {
    addr: poolTwoAddr.toBase58(),
    tickCurrentIndex: poolTwoData.tickCurrentIndex,
    tickSpacing: poolTwoData.tickSpacing,
    liquidity: poolTwoData.liquidity.toString(),
    sqrtPrice: poolTwoData.sqrtPrice.toString(),
  });
  console.log("[liquidate] pool1 (collateral/USDC):", {
    addr: poolOneAddr.toBase58(),
    tickCurrentIndex: poolOneData.tickCurrentIndex,
    tickSpacing: poolOneData.tickSpacing,
    liquidity: poolOneData.liquidity.toString(),
    sqrtPrice: poolOneData.sqrtPrice.toString(),
  });

  const slippage = Percentage.fromFraction(1, 100);
  const quoteTwo = await swapQuoteByOutputToken(
    poolTwo,
    XUSD_MINT,
    new BN(targetXusd.toString()),
    slippage,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ctx.fetcher,
    IGNORE_CACHE,
  ).catch((e) => {
    throw new Error(
      `pool 2 (XUSD/USDC) quote failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  const quoteOne = await swapQuoteByOutputToken(
    poolOne,
    USDC_MINT,
    quoteTwo.estimatedAmountIn,
    slippage,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ctx.fetcher,
    IGNORE_CACHE,
  ).catch((e) => {
    throw new Error(
      `pool 1 (collateral/USDC) quote failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  });

  const oracleOne = PDAUtil.getOracle(ORCA_WHIRLPOOL_PROGRAM_ID, poolOneAddr).publicKey;
  const oracleTwo = PDAUtil.getOracle(ORCA_WHIRLPOOL_PROGRAM_ID, poolTwoAddr).publicKey;

  const vaultAtaFor = (mint: PublicKey) => ata(vault, mint);

  const data = Buffer.concat([
    LIQUIDATION_DISCRIMINATOR,
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
      { pubkey: ORCA_WHIRLPOOL_PROGRAM_ID, isSigner: false, isWritable: false },
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

// ---------- tests ----------
describe("vault liquidation reproducer", () => {
  let provider: AnchorProvider;
  let connection: anchor.web3.Connection;
  let xiveProgram: Program<Xive>;
  let vaultProgram: Program<Vault>;
  let collateralsProgram: Program<Collaterals>;
  let user: Keypair;
  let victimPosition: PublicKey;

  // user.counter advances each open_position.
  // Funding position lands at counter=0 (victimPosition uses counter=1).
  const VICTIM_COLLATERAL_RAW = 10_000_000n; // 0.1 WETH (10^7, 8 decimals)
  // Amount the user *requests* (and receives). Recorded debt is request + commission.
  const VICTIM_REQUEST_XUSD_RAW = 100_000_000n; // 100 XUSD (6 decimals)
  const VICTIM_DEBT_XUSD_RAW =
    VICTIM_REQUEST_XUSD_RAW + (VICTIM_REQUEST_XUSD_RAW * 50n) / 10_000n; // = 100_500_000

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    connection = provider.connection;
    xiveProgram = anchor.workspace.xive as Program<Xive>;
    vaultProgram = anchor.workspace.vault as Program<Vault>;
    collateralsProgram = anchor.workspace.collaterals as Program<Collaterals>;
    user = Keypair.generate();
    console.log("[liq-test] user:", user.publicKey.toBase58());

    // Other test files may have moved the WETH price during their own run. Reset to the
    // default so this suite's LTV math is independent of execution order. The funding
    // wallet pays here since `user` isn't funded yet (rent for the surfnet_setAccount
    // payer only — collaterals.set_price needs a signer + 0 lamports for the call).
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

  it("funds the user with SOL, WETH, and USDC", async () => {
    await rpcCall("surfnet_setAccount", [
      user.publicKey.toBase58(),
      { lamports: 100_000_000_000 },
    ]);
    await rpcCall("surfnet_setTokenAccount", [
      user.publicKey.toBase58(),
      WETH_MINT.toBase58(),
      { amount: 10_000_000_000 }, // 100 WETH (10^10 with 8 decimals)
    ]);
    await rpcCall("surfnet_setTokenAccount", [
      user.publicKey.toBase58(),
      USDC_MINT.toBase58(),
      { amount: 10_000_000_000 }, // 10 000 USDC (10^10 with 6 decimals)
    ]);

    const wethBal = await connection.getTokenAccountBalance(ata(user.publicKey, WETH_MINT));
    expect(wethBal.value.amount).to.equal("10000000000");
    const usdcBal = await connection.getTokenAccountBalance(ata(user.publicKey, USDC_MINT));
    expect(usdcBal.value.amount).to.equal("10000000000");
  });

  it("creates the user state", async () => {
    await xiveProgram.methods
      .createUserState()
      .accounts({ user: user.publicKey })
      .signers([user])
      .rpc();
  });

  it("opens a funding position (borrows a large XUSD bag)", async () => {
    // 10 WETH (10^9 raw) at $3000 with 90% LTV → max ≈ 27 000 XUSD.
    // Borrow 5 000 XUSD = 5 * 10^9 raw.
    await xiveProgram.methods
      .openPosition(new BN(1_000_000_000), new BN(5_000_000_000))
      .accounts({
        user: user.publicKey,
        collateralMint: WETH_MINT,
      })
      .signers([user])
      .rpc();

    const xusdBal = await connection.getTokenAccountBalance(ata(user.publicKey, XUSD_MINT));
    // User receives the full requested amount; the 0.5% commission is added on top of the
    // recorded debt (see programs/xive/src/instructions/open_position.rs).
    expect(xusdBal.value.amount).to.equal("5000000000");
  });

  it("deposits XUSD into the vault", async () => {
    // 1 000 XUSD into vault — has to cover the burn during liquidate.
    await vaultProgram.methods
      .deposit(new BN(1_000_000_000))
      .accounts({ user: user.publicKey })
      .signers([user])
      .rpc();

    const vaultXusd = await connection.getTokenAccountBalance(ata(vaultPda(), XUSD_MINT));
    expect(vaultXusd.value.amount).to.equal("1000000000");
  });

  it("adds liquidity to the XUSD/USDC Orca pool", async () => {
    const wallet = new Wallet(user);
    const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
    const client = buildWhirlpoolClient(ctx);
    const pool = await client.getPool(xusdUsdcPoolAddress());

    const data = pool.getData();
    const tickCurrent = data.tickCurrentIndex;
    const tickSpacing = data.tickSpacing;
    const aligned = Math.floor(tickCurrent / tickSpacing) * tickSpacing;
    const tickLower = aligned - LP_RANGE_TICKS * tickSpacing;
    const tickUpper = aligned + LP_RANGE_TICKS * tickSpacing;
    console.log("[liq-test] pool2 BEFORE LP add:", {
      address: pool.getAddress().toBase58(),
      tickCurrent,
      tickSpacing,
      sqrtPrice: data.sqrtPrice.toString(),
      liquidity: data.liquidity.toString(),
      mintA: data.tokenMintA.toBase58(),
      mintB: data.tokenMintB.toBase58(),
      tickLower,
      tickUpper,
    });

    // Deposit ~1 000 USDC of LP (will pull a matching amount of XUSD).
    const quote = increaseLiquidityQuoteByInputToken(
      USDC_MINT,
      new Decimal("1000"),
      tickLower,
      tickUpper,
      Percentage.fromFraction(1, 100),
      pool,
      NO_TOKEN_EXTENSION_CONTEXT,
    );
    console.log("[liq-test] LP quote:", {
      liquidityAmount: quote.liquidityAmount.toString(),
      tokenEstA: quote.tokenEstA.toString(),
      tokenEstB: quote.tokenEstB.toString(),
      tokenMaxA: quote.tokenMaxA.toString(),
      tokenMaxB: quote.tokenMaxB.toString(),
    });

    const { positionMint, tx } = await pool.openPositionWithMetadata(
      tickLower,
      tickUpper,
      quote,
    );
    console.log("[liq-test] new position mint:", positionMint.toBase58());

    const startTicks = new Set<number>(
      [tickLower, tickUpper, aligned].map((t) => TickUtil.getStartTickIndex(t, tickSpacing)),
    );
    for (const startTick of startTicks) {
      const tickArrayPda = PDAUtil.getTickArray(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        pool.getAddress(),
        startTick,
      );
      const info = await connection.getAccountInfo(tickArrayPda.publicKey);
      console.log(`[liq-test] tick array start=${startTick} exists=${info != null}`);
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

    const sig = await tx.buildAndExecute();
    console.log("[liq-test] LP tx sig:", sig);

    const refreshed = await client.getPool(xusdUsdcPoolAddress(), IGNORE_CACHE);
    const refreshedData = refreshed.getData();
    console.log("[liq-test] pool2 AFTER LP add:", {
      tickCurrent: refreshedData.tickCurrentIndex,
      sqrtPrice: refreshedData.sqrtPrice.toString(),
      liquidity: refreshedData.liquidity.toString(),
    });
    const positionPda = PDAUtil.getPosition(ORCA_WHIRLPOOL_PROGRAM_ID, positionMint).publicKey;
    const posData = await ctx.fetcher.getPosition(positionPda, IGNORE_CACHE);
    console.log("[liq-test] new orca position:", {
      address: positionPda.toBase58(),
      tickLowerIndex: posData?.tickLowerIndex,
      tickUpperIndex: posData?.tickUpperIndex,
      liquidity: posData?.liquidity.toString(),
    });
    expect(refreshedData.liquidity.gt(new BN(0))).to.equal(true);
  });

  it("opens the victim position (small loan, normal LTV)", async () => {
    // 0.1 WETH at $3000 with 90% LTV → max 270 XUSD. Borrow 100 XUSD (debt becomes 100.5).
    await xiveProgram.methods
      .openPosition(new BN(VICTIM_COLLATERAL_RAW.toString()), new BN(VICTIM_REQUEST_XUSD_RAW.toString()))
      .accounts({
        user: user.publicKey,
        collateralMint: WETH_MINT,
      })
      .signers([user])
      .rpc();

    victimPosition = positionPda(user.publicKey, 1n); // funding position used counter=0
    const pos = await xiveProgram.account.position.fetch(victimPosition);
    expect(pos.loanAmount.toString()).to.equal(VICTIM_DEBT_XUSD_RAW.toString());
  });

  it("drops the WETH price so the victim is liquidatable", async () => {
    // Bonus 5% means we must be above liq_ltv (95%). Set price = 1000 (was 3000).
    // 0.1 WETH * $1000 = $100 collateral value vs $100 debt → 100% LTV > 95% liquidation threshold.
    // The collateral PDA seed depends on the account's own `mint` field, so the IDL
    // can't auto-derive it — cast to bypass the strict accounts() type.
    await collateralsProgram.methods
      .setPrice(new BN(1000))
      .accounts({
        payer: user.publicKey,
        collateral: collateralPda(WETH_MINT),
      } as never)
      .signers([user])
      .rpc();
  });

  it("liquidates the victim position via vault.liquidate", async () => {
    const ix = await buildVaultLiquidateIx({
      connection,
      payer: user.publicKey,
      position: victimPosition,
      collateralMint: WETH_MINT,
      debt: VICTIM_DEBT_XUSD_RAW,
    });
    // The full vault.liquidate path (ATA inits + xive.liquidate CPI + Orca TwoHopSwap +
    // xive.return_collateral CPI) doesn't fit in the default 200k CU budget.
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ix);
    const sig = await provider.sendAndConfirm(tx, [user]);
    console.log("[liq-test] liquidate sig:", sig);

    const pos = await xiveProgram.account.position.fetch(victimPosition);
    expect(pos.loanAmount.toString()).to.equal("0");
  });
});
