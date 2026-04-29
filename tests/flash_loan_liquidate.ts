/**
 * End-to-end test for `vault::flash_loan_liquidate`.
 *
 * Unlike the swap-based vault.liquidate, this path needs zero XUSD reserves in
 * the vault — the vault flash-mints exactly `debt` XUSD via peg_keeper, burns it
 * through `xive::liquidate`, and walks away with the seized collateral.
 *
 *   1. fund a fresh user (SOL + WETH)
 *   2. createUserState + open the victim position
 *   3. drop the WETH price so the position is liquidatable
 *   4. vault.flash_loan_liquidate — verify position is closed and vault holds
 *      the seized collateral, with no XUSD left on either side.
 */
import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { expect } from "chai";

import type { Vault } from "../target/types/vault.js";
import type { Xive } from "../target/types/xive.js";
import { rpcCall } from "./utils.js";

const XIVE_PROGRAM_ID = new PublicKey("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");
const VAULT_PROGRAM_ID = new PublicKey("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");
const PEG_KEEPER_PROGRAM_ID = new PublicKey("xpeguefXy5MrgkbirCyuCCD5EfbUM5UfejdQduDcGz6");
const XUSD_MINT = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

function vaultPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], VAULT_PROGRAM_ID)[0];
}

function xivePda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("xive")], XIVE_PROGRAM_ID)[0];
}

function pegKeeperPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("peg-keeper")],
    PEG_KEEPER_PROGRAM_ID,
  )[0];
}

function collateralPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), mint.toBuffer()],
    XIVE_PROGRAM_ID,
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

describe("vault — flash_loan_liquidate", () => {
  let provider: AnchorProvider;
  let connection: anchor.web3.Connection;
  let xiveProgram: Program<Xive>;
  let vaultProgram: Program<Vault>;
  let user: Keypair;
  let victimPosition: PublicKey;

  // 0.1 WETH at $3000 (8 decimals) → $300 collateral. Borrow 100 XUSD; debt = 100 + 0.5 fee.
  const VICTIM_COLLATERAL_RAW = 10_000_000n;
  const VICTIM_REQUEST_XUSD_RAW = 100_000_000n;
  const VICTIM_DEBT_XUSD_RAW =
    VICTIM_REQUEST_XUSD_RAW + (VICTIM_REQUEST_XUSD_RAW * 50n) / 10_000n; // 100_500_000

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    connection = provider.connection;
    xiveProgram = anchor.workspace.xive as Program<Xive>;
    vaultProgram = anchor.workspace.vault as Program<Vault>;
    user = Keypair.generate();
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
  });

  it("creates user state and opens the victim position", async () => {
    await xiveProgram.methods
      .createUserState()
      .accounts({ user: user.publicKey })
      .signers([user])
      .rpc();

    await xiveProgram.methods
      .openPosition(
        new BN(VICTIM_COLLATERAL_RAW.toString()),
        new BN(VICTIM_REQUEST_XUSD_RAW.toString()),
      )
      .accounts({
        user: user.publicKey,
        collateralMint: WETH_MINT,
      })
      .signers([user])
      .rpc();

    victimPosition = positionPda(user.publicKey, 0n);
    const pos = await xiveProgram.account.position.fetch(victimPosition);
    expect(pos.loanAmount.toString()).to.equal(VICTIM_DEBT_XUSD_RAW.toString());
    expect(pos.collateralAmount.toString()).to.equal(VICTIM_COLLATERAL_RAW.toString());
  });

  it("drops the WETH price so the position is liquidatable", async () => {
    // 0.1 WETH * $1000 = $100 vs $100.5 debt → ~100% LTV > 95% liquidation threshold.
    await xiveProgram.methods
      .setPrice(new BN(1000))
      .accounts({
        payer: user.publicKey,
        collateral: collateralPda(WETH_MINT),
      } as never)
      .signers([user])
      .rpc();
  });

  it("flash-loan liquidates without any XUSD reserves", async () => {
    const vault = vaultPda();
    const xive = xivePda();
    const vaultXusdAta = ata(vault, XUSD_MINT);
    const vaultCollateralAta = ata(vault, WETH_MINT);
    const xiveCollateralAta = ata(xive, WETH_MINT);

    const collateralBefore = BigInt(
      (await connection.getTokenAccountBalance(vaultCollateralAta).catch(() => ({
        value: { amount: "0" },
      }))).value.amount,
    );

    const ix = await vaultProgram.methods
      .flashLoanLiquidate()
      .accounts({
        payer: user.publicKey,
        xiveProgram: XIVE_PROGRAM_ID,
        xiveState: xive,
        xiveCollateral: collateralPda(WETH_MINT),
        position: victimPosition,
        xusdMint: XUSD_MINT,
        vaultXusdAta,
        collateralMint: WETH_MINT,
        vaultCollateralAta,
        xiveCollateralAta,
        pegKeeperProgram: PEG_KEEPER_PROGRAM_ID,
        pegKeeper: pegKeeperPda(),
      } as never)
      .instruction();

    // Two CPIs (peg_keeper.mint_xusd → xive.flash_mint_for_liquidation, then xive.liquidate)
    // plus two ATA inits push past the default 200k CU budget.
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ix);
    const sig = await provider.sendAndConfirm(tx, [user]);
    console.log("[flash-liq-test] tx sig:", sig);

    // Position is closed.
    const pos = await xiveProgram.account.position.fetch(victimPosition);
    expect(pos.loanAmount.toString()).to.equal("0");
    expect(pos.collateralAmount.toString()).to.equal("0");

    // Vault netted exactly the seized collateral; XUSD was minted+burned in the same tx.
    const vaultCollateralAfter = BigInt(
      (await connection.getTokenAccountBalance(vaultCollateralAta)).value.amount,
    );
    expect(vaultCollateralAfter - collateralBefore).to.equal(VICTIM_COLLATERAL_RAW);

    const vaultXusdAfter = await connection.getTokenAccountBalance(vaultXusdAta);
    expect(vaultXusdAfter.value.amount).to.equal("0");
  });
});
