import { assert, expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  transferChecked,
} from "@solana/spl-token";

import {
  xiveProgram,
  connection,
  payer,
  XUSD_MINT,
  xivePda,
  walletPda,
  positionPda,
  collateralPda,
  ata,
  bn,
  createTestMint,
  mintTokens,
  newFundedKeypair,
  ataBalance,
  accountExists,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SystemProgram,
} from "./helpers.js";

const COLL_DECIMALS = 6;
const ONE = 10 ** COLL_DECIMALS; // 1 whole token / xUSD
const PRICE = 1_000_000; // $1 per whole token, in 1e6 value units
const LTV = 5000; // 50%
const LIQ_LTV = 8000; // 80%
const LOAN_FEE_BPS = 100; // matches hooks

async function expectError(p: Promise<any>, code: string) {
  let threw = false;
  try {
    await p;
  } catch (e: any) {
    const blob = [
      e?.toString?.() ?? "",
      e?.message ?? "",
      typeof e?.error === "object" ? JSON.stringify(e.error) : "",
      Array.isArray(e?.logs) ? e.logs.join("\n") : "",
    ].join("\n");
    if (!blob.includes(code)) {
      throw new Error(`expected error '${code}', but got a different error:\n${blob}`);
    }
    return;
  }
  if (!threw) assert.fail(`expected error '${code}', but the tx succeeded`);
}

async function initWallet(borrower: Keypair) {
  if (await accountExists(walletPda(borrower.publicKey))) return;
  await xiveProgram.methods
    .initWallet()
    .accountsPartial({
      borrower: borrower.publicKey,
      wallet: walletPda(borrower.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([borrower])
    .rpc();
}

async function walletIndex(borrower: PublicKey): Promise<bigint> {
  const w = await xiveProgram.account.wallet.fetch(walletPda(borrower));
  return BigInt(w.index.toString());
}

async function openPosition(
  borrower: Keypair,
  collMint: PublicKey,
  collateralAmount: number,
  loanAmount: number,
) {
  const index = await walletIndex(borrower.publicKey);
  const position = positionPda(borrower.publicKey, index);
  await xiveProgram.methods
    .openPosition(bn(collateralAmount), bn(loanAmount))
    .accountsPartial({
      borrower: borrower.publicKey,
      wallet: walletPda(borrower.publicKey),
      position,
      collateralMint: collMint,
      borrowerXusdAta: ata(borrower.publicKey, XUSD_MINT),
      borrowerCollateralAta: ata(borrower.publicKey, collMint),
      programCollateralAta: ata(xivePda(), collMint),
      collateral: collateralPda(collMint),
      xusdMint: XUSD_MINT,
      xive: xivePda(),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([borrower])
    .rpc();
  return position;
}

describe("positions", () => {
  let collMint: PublicKey;
  let borrower: Keypair;

  // a wallet holding spare xUSD so borrowers can cover the origination fee on full repay/close
  let faucetXusd: PublicKey;

  before(async function () {
    this.timeout(120000);

    collMint = await createTestMint(COLL_DECIMALS);

    // enable + price the collateral
    await xiveProgram.methods
      .updateCollateral(true, LTV, LIQ_LTV)
      .accountsPartial({
        authority: payer.publicKey,
        mint: collMint,
        collateral: collateralPda(collMint),
        xive: xivePda(),
        programCollateralAta: ata(xivePda(), collMint),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    await xiveProgram.methods
      .setCollateralPrice(bn(PRICE))
      .accountsPartial({
        authority: payer.publicKey,
        mint: collMint,
        collateral: collateralPda(collMint),
      })
      .rpc();

    // faucet: payer borrows a large amount of xUSD to top up fee gaps later
    const faucet = Keypair.fromSecretKey(payer.secretKey);
    await initWallet(faucet);
    await mintTokens(collMint, faucet.publicKey, 1_000_000 * ONE);
    await openPosition(faucet, collMint, 1_000_000 * ONE, 100_000 * ONE);
    faucetXusd = ata(faucet.publicKey, XUSD_MINT);

    borrower = await newFundedKeypair();
    await initWallet(borrower);
    await mintTokens(collMint, borrower.publicKey, 10_000 * ONE);
  });

  async function topUpXusd(to: PublicKey, amount: number) {
    const dest = await getOrCreateAssociatedTokenAccount(connection, payer, XUSD_MINT, to, true);
    await transferChecked(connection, payer, faucetXusd, XUSD_MINT, dest.address, payer, amount, 6);
  }

  it("opens a position and charges the fee, split 20/80 vault/team", async () => {
    const xiveBefore = await xiveProgram.account.xive.fetch(xivePda());

    const collateral = 1000 * ONE;
    const loan = 400 * ONE;
    const position = await openPosition(borrower, collMint, collateral, loan);

    const pos = await xiveProgram.account.position.fetch(position);
    expect(pos.collateralAmount.toString()).to.eq(String(collateral));
    expect(pos.loanAmount.toString()).to.eq(String(loan));
    expect(pos.closeDate.toString()).to.eq("0");

    // borrower receives loan minus the 1% fee
    const fee = (loan * LOAN_FEE_BPS) / 10_000;
    expect((await ataBalance(borrower.publicKey, XUSD_MINT)).toString()).to.eq(String(loan - fee));

    // fee split: 20% vault, 80% team
    const vaultFee = Math.floor(fee / 5);
    const teamFee = fee - vaultFee;
    const xiveAfter = await xiveProgram.account.xive.fetch(xivePda());
    expect(
      BigInt(xiveAfter.vaultBalance.toString()) - BigInt(xiveBefore.vaultBalance.toString()),
    ).to.eq(BigInt(vaultFee));
    expect(
      BigInt(xiveAfter.teamBalance.toString()) - BigInt(xiveBefore.teamBalance.toString()),
    ).to.eq(BigInt(teamFee));

    // collateral moved into the shared program pool
    assert.isTrue((await ataBalance(xivePda(), collMint)) >= BigInt(collateral));
  });

  it("rejects opening above the max LTV", async () => {
    const b = await newFundedKeypair();
    await initWallet(b);
    await mintTokens(collMint, b.publicKey, 1000 * ONE);
    // 1000 collateral ($1000) at 50% LTV allows 500; ask for 501
    await expectError(openPosition(b, collMint, 1000 * ONE, 501 * ONE), "LTVBreached");
  });

  it("rejects borrowing against disabled collateral", async () => {
    const disabled = await createTestMint(COLL_DECIMALS);
    await xiveProgram.methods
      .updateCollateral(false, LTV, LIQ_LTV)
      .accountsPartial({
        authority: payer.publicKey,
        mint: disabled,
        collateral: collateralPda(disabled),
        xive: xivePda(),
        programCollateralAta: ata(xivePda(), disabled),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    await xiveProgram.methods
      .setCollateralPrice(bn(PRICE))
      .accountsPartial({
        authority: payer.publicKey,
        mint: disabled,
        collateral: collateralPda(disabled),
      })
      .rpc();

    const b = await newFundedKeypair();
    await initWallet(b);
    await mintTokens(disabled, b.publicKey, 1000 * ONE);
    await expectError(openPosition(b, disabled, 1000 * ONE, 100 * ONE), "CollateralDisabled");
  });

  it("deposits more collateral into a position", async () => {
    const index = await walletIndex(borrower.publicKey);
    const position = positionPda(borrower.publicKey, index - 1n); // the position opened in test 1
    const before = await xiveProgram.account.position.fetch(position);

    const add = 500 * ONE;
    await xiveProgram.methods
      .deposit(bn(add))
      .accountsPartial({
        borrower: borrower.publicKey,
        position,
        collateralMint: collMint,
        borrowerCollateralAta: ata(borrower.publicKey, collMint),
        programCollateralAta: ata(xivePda(), collMint),
        xive: xivePda(),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([borrower])
      .rpc();

    const after = await xiveProgram.account.position.fetch(position);
    expect(
      BigInt(after.collateralAmount.toString()) - BigInt(before.collateralAmount.toString()),
    ).to.eq(BigInt(add));
  });

  it("borrows more within LTV and rejects above it", async () => {
    const index = await walletIndex(borrower.publicKey);
    const position = positionPda(borrower.publicKey, index - 1n);
    // collateral now 1500 ($1500), loan 400; max loan = 750; headroom = 350
    const borrowMore = (amount: number) =>
      xiveProgram.methods
        .borrow(bn(amount))
        .accountsPartial({
          borrower: borrower.publicKey,
          position,
          borrowerXusdAta: ata(borrower.publicKey, XUSD_MINT),
          xusdMint: XUSD_MINT,
          collateral: collateralPda(collMint),
          collateralMint: collMint,
          xive: xivePda(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([borrower])
        .rpc();

    await borrowMore(300 * ONE); // ok -> loan 700, bps ~4667 < 5000
    await expectError(borrowMore(200 * ONE), "LTVBreached"); // would push loan to 900 > 750
  });

  it("repays part of the loan", async () => {
    const index = await walletIndex(borrower.publicKey);
    const position = positionPda(borrower.publicKey, index - 1n);
    const before = await xiveProgram.account.position.fetch(position);

    const repay = 100 * ONE;
    await xiveProgram.methods
      .repay(bn(repay))
      .accountsPartial({
        borrower: borrower.publicKey,
        position,
        borrowerXusdAta: ata(borrower.publicKey, XUSD_MINT),
        xusdMint: XUSD_MINT,
        xive: xivePda(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([borrower])
      .rpc();

    const after = await xiveProgram.account.position.fetch(position);
    expect(
      BigInt(before.loanAmount.toString()) - BigInt(after.loanAmount.toString()),
    ).to.eq(BigInt(repay));
  });

  it("withdraws collateral within LTV and rejects an unhealthy withdraw", async () => {
    const index = await walletIndex(borrower.publicKey);
    const position = positionPda(borrower.publicKey, index - 1n);

    const withdraw = (amount: number) =>
      xiveProgram.methods
        .withdraw(bn(amount))
        .accountsPartial({
          borrower: borrower.publicKey,
          position,
          collateral: collateralPda(collMint),
          collateralMint: collMint,
          programCollateralAta: ata(xivePda(), collMint),
          borrowerCollateralAta: ata(borrower.publicKey, collMint),
          xive: xivePda(),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([borrower])
        .rpc();

    // loan now 600, collateral 1500. Need collateral >= loan/LTV = 1200. Can pull up to 300.
    await withdraw(200 * ONE); // ok -> collateral 1300
    // NOTE: distinct amount on purpose — surfpool reuses the blockhash, so a byte-identical
    // tx (withdraw 200 again) would collide as "already processed" instead of running.
    await expectError(withdraw(300 * ONE), "LTVBreached"); // 1300 - 300 = 1000 < 1200
  });

  it("closes a position (repays remainder + returns collateral)", async () => {
    const b = await newFundedKeypair();
    await initWallet(b);
    await mintTokens(collMint, b.publicKey, 1000 * ONE);
    const position = await openPosition(b, collMint, 1000 * ONE, 200 * ONE);

    // cover the fee gap so the borrower can burn the full loan_amount
    await topUpXusd(b.publicKey, 10 * ONE);

    const collBefore = await ataBalance(b.publicKey, collMint);
    await xiveProgram.methods
      .closePosition()
      .accountsPartial({
        borrower: b.publicKey,
        position,
        borrowerXusdAta: ata(b.publicKey, XUSD_MINT),
        xusdMint: XUSD_MINT,
        collateralMint: collMint,
        programCollateralAta: ata(xivePda(), collMint),
        borrowerCollateralAta: ata(b.publicKey, collMint),
        xive: xivePda(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([b])
      .rpc();

    const pos = await xiveProgram.account.position.fetch(position);
    expect(pos.loanAmount.toString()).to.eq("0");
    expect(pos.collateralAmount.toString()).to.eq("0");
    expect(pos.closeDate.toString()).to.not.eq("0");
    // collateral returned to the borrower
    expect(await ataBalance(b.publicKey, collMint)).to.eq(collBefore + BigInt(1000 * ONE));
  });
});
