import path from "path";
import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { PublicKey, Keypair } from "@solana/web3.js";
import {getAccount, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount} from "@solana/spl-token";
import { expect } from "chai";
import type { Xive } from "../target/types/xive.ts";
import { rpcCall, getKeyPair, PROJECT_ROOT } from "./utils.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");
const XUSD_MINT = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
const XIVE_PROGRAM_ID = new PublicKey("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");

// Default WETH price set by the hooks setup (mirrors COLLATERALS.WETH.price in tests/hooks.ts).
const WETH_DEFAULT_PRICE = 3000;

// Mirrors programs/xive/src/constants.rs::DEFAULT_COMMISSION_BPS — fee on every borrow.
const COMMISSION_BPS = 50n;
const fee = (loan: bigint) => (loan * COMMISSION_BPS) / 10_000n;

function getATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

function positionPda(user: PublicKey, counter: bigint): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(counter);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), buf],
    XIVE_PROGRAM_ID,
  );
  return pda;
}

function collateralPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), mint.toBuffer()],
    XIVE_PROGRAM_ID,
  );
  return pda;
}

describe("xive — lending flow (surfpool mainnet fork)", () => {
  let provider: anchor.AnchorProvider;
  let xiveProgram: Program<Xive>;
  let testWallet: Keypair;

  let position0: PublicKey;
  let position1: PublicKey;
  let userXusdAta: PublicKey;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    xiveProgram = anchor.workspace.xive as Program<Xive>;
    testWallet = getKeyPair(path.join(PROJECT_ROOT, "keys/test-wallet.json"));

    position0 = positionPda(testWallet.publicKey, 0n);
    position1 = positionPda(testWallet.publicKey, 1n);
    userXusdAta = getATA(testWallet.publicKey, XUSD_MINT);

    // Seed test wallet with WETH on the mainnet fork
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      testWallet,
      WETH_MINT,
      testWallet.publicKey
    );
    await rpcCall("surfnet_setTokenAccount", [
      testWallet.publicKey,
      WETH_MINT,
      { amount: 1_000_000 },
    ]);

    await new Promise(resolve => setTimeout(resolve, 1000));
    const ata = await getAssociatedTokenAddress(WETH_MINT, testWallet.publicKey);
    const account = await getAccount(provider.connection, ata, "confirmed");
    expect(account.amount).to.equal(1_000_000n);

    // Other test files (e.g. liquidate.ts) may have moved the WETH price during their own
    // run — the global mochaHooks state is shared. Reset to the default so this suite's
    // LTV math is independent of test execution order.
    await xiveProgram.methods
      .setPrice(new BN(WETH_DEFAULT_PRICE))
      .accounts({
        payer: testWallet.publicKey,
        collateral: collateralPda(WETH_MINT),
      } as never)
      .signers([testWallet])
      .rpc();
  });

  it("create user state", async () => {
    await xiveProgram.methods
      .createUserState()
      .accounts({
        user: testWallet.publicKey,
      })
      .signers([testWallet])
      .rpc();
  });

  it("opens position 0", async () => {
    await xiveProgram.methods
      .openPosition(new BN(100_000), new BN(1_000))
      .accounts({
        user: testWallet.publicKey,
        collateralMint: WETH_MINT,
      })
      .signers([testWallet])
      .rpc();

    const pos = await xiveProgram.account.position.fetch(position0);
    expect(pos.collateralAmount.toString()).to.equal("100000");
    // User asked for 1000 XUSD; debt records the full debt = 1000 + 5 fee = 1005.
    expect(pos.loanAmount.toString()).to.equal((1000n + fee(1000n)).toString());

    const xusd = await provider.connection.getTokenAccountBalance(userXusdAta);
    // User receives the full requested amount.
    expect(xusd.value.amount).to.equal("1000");
  });

  it("deposits more collateral", async () => {
    await xiveProgram.methods
      .depositCollateral(new BN(50_000))
      .accounts({
        user: testWallet.publicKey,
        position: position0,
        collateralMint: WETH_MINT,
      })
      .signers([testWallet])
      .rpc();

    const pos = await xiveProgram.account.position.fetch(position0);
    expect(pos.collateralAmount.toString()).to.equal("150000");
  });

  it("borrows more XUSD", async () => {
    await xiveProgram.methods
      .borrow(new BN(500))
      .accounts({
        user: testWallet.publicKey,
        position: position0,
        collateralMint: WETH_MINT,
      })
      .signers([testWallet])
      .rpc();

    const pos = await xiveProgram.account.position.fetch(position0);
    // Debt grows by 500 + fee(500) = 502. New debt = 1005 + 502 = 1507.
    const expectedDebt = (1000n + fee(1000n)) + (500n + fee(500n));
    expect(pos.loanAmount.toString()).to.equal(expectedDebt.toString());

    const xusd = await provider.connection.getTokenAccountBalance(userXusdAta);
    // User already had 1000 from the first open and now receives the full extra 500.
    expect(xusd.value.amount).to.equal("1500");
  });

  it("repays XUSD", async () => {
    await xiveProgram.methods
      .repay(new BN(500))
      .accounts({
        user: testWallet.publicKey,
        position: position0,
      })
      .signers([testWallet])
      .rpc();

    const pos = await xiveProgram.account.position.fetch(position0);
    // Repaying 500 against debt 1507 → debt = 1007.
    const expectedDebt = (1000n + fee(1000n)) + (500n + fee(500n)) - 500n;
    expect(pos.loanAmount.toString()).to.equal(expectedDebt.toString());

    const xusd = await provider.connection.getTokenAccountBalance(userXusdAta);
    // 1500 - 500 repaid.
    expect(xusd.value.amount).to.equal("1000");
  });

  it("withdraws collateral", async () => {
    await xiveProgram.methods
      .withdrawCollateral(new BN(50_000))
      .accounts({
        user: testWallet.publicKey,
        position: position0,
        collateralMint: WETH_MINT,
      })
      .signers([testWallet])
      .rpc();

    const pos = await xiveProgram.account.position.fetch(position0);
    expect(pos.collateralAmount.toString()).to.equal("100000");
  });

  it("rejects opening a position that exceeds LTV", async () => {
    try {
      await xiveProgram.methods
        .openPosition(new BN(100), new BN(1_000_000_000_000))
        .accounts({
          user: testWallet.publicKey,
          collateralMint: WETH_MINT,
        })
        .signers([testWallet])
        .rpc();
      expect.fail("expected InsufficientCollateral");
    } catch (err: any) {
      expect(err.toString()).to.match(/InsufficientCollateral/);
    }
  });

  it("rejects a withdraw that would violate LTV", async () => {
    // Open a second, near-max-LTV position. With WETH (8 dec) collateral=100 raw at price=$3000
    // and 90% LTV, max_loan = 100 * 3000 * 0.9 / 10^(8-6) = 2700 raw XUSD. Borrow 2500 (≈93% of cap).
    await xiveProgram.methods
      .openPosition(new BN(100), new BN(2_500))
      .accounts({
        user: testWallet.publicKey,
        collateralMint: WETH_MINT,
      })
      .signers([testWallet])
      .rpc();

    try {
      await xiveProgram.methods
        .withdrawCollateral(new BN(70))
        .accounts({
          user: testWallet.publicKey,
          position: position1,
          collateralMint: WETH_MINT,
        })
        .signers([testWallet])
        .rpc();
      expect.fail("expected InsufficientCollateral");
    } catch (err: any) {
      expect(err.toString()).to.match(/InsufficientCollateral/);
    }
  });
});
