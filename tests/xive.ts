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
    expect(pos.loanAmount.toString()).to.equal("1000");

    const xusd = await provider.connection.getTokenAccountBalance(userXusdAta);
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
      })
      .signers([testWallet])
      .rpc();

    const pos = await xiveProgram.account.position.fetch(position0);
    expect(pos.loanAmount.toString()).to.equal("1500");

    const xusd = await provider.connection.getTokenAccountBalance(userXusdAta);
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
    expect(pos.loanAmount.toString()).to.equal("1000");

    const xusd = await provider.connection.getTokenAccountBalance(userXusdAta);
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
    // Open a second, highly-leveraged position
    await xiveProgram.methods
      .openPosition(new BN(100), new BN(10_000_000))
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
