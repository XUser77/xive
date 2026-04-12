import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import BN from "bn.js";
import type { Xive } from "../target/types/xive";
import type { PegKeeper } from "../target/types/peg_keeper";
import type { Collateral } from "../target/types/collateral";
import { expect } from "chai";

const { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Mainnet WETH (Portal) mint — 8 decimals
const WETH_MINT = new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");

/** Derive an Associated Token Account address */
function getATA(owner: anchor.web3.PublicKey, mint: anchor.web3.PublicKey): anchor.web3.PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/** Call a surfnet_* cheatcode on the local surfpool RPC */
async function surfnetRpc(method: string, params: any[]): Promise<any> {
  const res = await fetch("http://127.0.0.1:8899", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

describe("xive — take loan with WETH collateral (surfpool mainnet fork)", () => {
  // Initialized lazily in before() so test discovery works without a running validator
  let provider: anchor.AnchorProvider;
  let xiveProgram: Program<Xive>;
  let pegKeeperProgram: Program<PegKeeper>;
  let collateralProgram: Program<Collateral>;

  const borrower = Keypair.generate();

  // ── PDAs (computed from program IDs, safe to derive without a connection) ─

  // These are computed in before() once we have program IDs
  let xivePda: anchor.web3.PublicKey;
  let pegKeeperPda: anchor.web3.PublicKey;
  let xusdMint: anchor.web3.PublicKey;
  let collateralPda: anchor.web3.PublicKey;
  let loanPda: anchor.web3.PublicKey;
  let borrowerWethAta: anchor.web3.PublicKey;
  let vaultAta: anchor.web3.PublicKey;
  let borrowerXusdAta: anchor.web3.PublicKey;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

xiveProgram = anchor.workspace.xive as Program<Xive>;
    pegKeeperProgram = anchor.workspace.pegKeeper as Program<PegKeeper>;
    collateralProgram = anchor.workspace.collateral as Program<Collateral>;

    [xivePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("xive")],
      xiveProgram.programId,
    );
    [pegKeeperPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("peg-keeper")],
      pegKeeperProgram.programId,
    );
    [xusdMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("xusd-mint")],
      pegKeeperProgram.programId,
    );
    [collateralPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("collateral"), WETH_MINT.toBuffer()],
      collateralProgram.programId,
    );
    [loanPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("loan"), borrower.publicKey.toBuffer(), WETH_MINT.toBuffer()],
      xiveProgram.programId,
    );

    borrowerWethAta = getATA(borrower.publicKey, WETH_MINT);
    vaultAta = getATA(xivePda, WETH_MINT);
    borrowerXusdAta = getATA(borrower.publicKey, xusdMint);
  });

  // ── Setup ─────────────────────────────────────────────────────────────

  it("initializes xive singleton", async () => {
    const tx = await xiveProgram.methods.initialize().rpc();
    console.log("  xive initialized:", tx);

    const xive = await xiveProgram.account.xive.fetch(xivePda);
    expect(xive.admin.toString()).to.equal(provider.wallet.publicKey.toString());
  });

  it("initializes peg_keeper and XUSD mint", async () => {
    const tx = await pegKeeperProgram.methods.initialize().rpc();
    console.log("  peg_keeper initialized:", tx);

    const pk = await pegKeeperProgram.account.pegKeeper.fetch(pegKeeperPda);
    expect(pk.xusdMint.toString()).to.equal(xusdMint.toString());
    expect(pk.decimals).to.equal(6);
  });

  it("sets xive PDA as authorized minter on peg_keeper", async () => {
    const tx = await pegKeeperProgram.methods
      .setAuthorizedMinter(xivePda)
      .accounts({
        pegKeeper: pegKeeperPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();
    console.log("  authorized minter set:", tx);

    const pk = await pegKeeperProgram.account.pegKeeper.fetch(pegKeeperPda);
    expect(pk.authorizedMinter.toString()).to.equal(xivePda.toString());
  });

  it("creates WETH collateral via xive CPI", async () => {
    const tx = await xiveProgram.methods
      .createCollateral()
      .accounts({
        admin: provider.wallet.publicKey,
        collateralTokenMint: WETH_MINT,
        collateral: collateralPda,
        collateralProgram: collateralProgram.programId,
      })
      .rpc();
    console.log("  WETH collateral created:", tx);

    const coll = await collateralProgram.account.collateral.fetch(collateralPda);
    expect(coll.tokenMint.toString()).to.equal(WETH_MINT.toString());
  });

  it("sets WETH price to $3 000", async () => {
    const price = new BN(3_000_000_000); // $3000 in XUSD base units (6 dec)
    const tx = await collateralProgram.methods
      .setPrice(price)
      .accounts({
        collateralTokenMint: WETH_MINT,
        collateral: collateralPda,
      })
      .rpc();
    console.log("  WETH price set:", tx);

    const coll = await collateralProgram.account.collateral.fetch(collateralPda);
    expect(coll.price.toNumber()).to.equal(3_000_000_000);
  });

  // ── Fund borrower via surfpool cheatcodes ─────────────────────────────

  it("funds borrower with SOL and WETH (surfpool cheatcode)", async () => {
    // Airdrop SOL for tx fees + rent
    const sig = await provider.connection.requestAirdrop(
      borrower.publicKey,
      2 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig);

    const solBal = await provider.connection.getBalance(borrower.publicKey);
    expect(solBal).to.be.greaterThanOrEqual(2 * LAMPORTS_PER_SOL);
    console.log("  borrower SOL:", solBal / LAMPORTS_PER_SOL);

    // Give borrower 10 WETH via surfpool cheatcode
    const result = await surfnetRpc("surfnet_setTokenAccount", [
      borrower.publicKey.toString(),
      WETH_MINT.toString(),
      { amount: 1000000000 }, // 10 WETH (8 decimals) — must be integer, not string
    ]);
    console.log("  surfnet_setTokenAccount result:", JSON.stringify(result));

    const wethBal = await provider.connection.getTokenAccountBalance(borrowerWethAta);
    expect(wethBal.value.amount).to.equal("1000000000");
    console.log("  borrower WETH:", wethBal.value.uiAmountString);
  });

  // ── Take loan ─────────────────────────────────────────────────────────

  it("takes loan: deposits 1 WETH, receives 3 000 XUSD", async () => {
    const depositAmount = new BN(100_000_000); // 1 WETH (8 dec)

    const tx = await xiveProgram.methods
      .takeLoan(depositAmount)
      .accounts({
        borrower: borrower.publicKey,
        xive: xivePda,
        collateral: collateralPda,
        collateralTokenMint: WETH_MINT,
        borrowerCollateralAccount: borrowerWethAta,
        vault: vaultAta,
        loan: loanPda,
        pegKeeperAccount: pegKeeperPda,
        xusdMint: xusdMint,
        borrowerXusdAccount: borrowerXusdAta,
        pegKeeperProgram: pegKeeperProgram.programId,
        collateralProgram: collateralProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([borrower])
      .rpc();
    console.log("  take_loan tx:", tx);

    // ── Assertions ────────────────────────────────────────────────────

    const loan = await xiveProgram.account.loan.fetch(loanPda);
    expect(loan.borrower.toString()).to.equal(borrower.publicKey.toString());
    expect(loan.collateralMint.toString()).to.equal(WETH_MINT.toString());
    expect(loan.collateralAmount.toNumber()).to.equal(100_000_000);
    expect(loan.xusdBorrowed.toNumber()).to.equal(3_000_000_000);
    console.log("  loan collateral:", loan.collateralAmount.toNumber());
    console.log("  loan xusd borrowed:", loan.xusdBorrowed.toNumber());

    // Borrower received XUSD
    const xusdBal = await provider.connection.getTokenAccountBalance(borrowerXusdAta);
    expect(xusdBal.value.amount).to.equal("3000000000");
    console.log("  borrower XUSD balance:", xusdBal.value.uiAmountString);

    // Vault received WETH
    const vaultBal = await provider.connection.getTokenAccountBalance(vaultAta);
    expect(vaultBal.value.amount).to.equal("100000000");
    console.log("  vault WETH balance:", vaultBal.value.uiAmountString);

    // Borrower WETH decreased by 1
    const wethBal = await provider.connection.getTokenAccountBalance(borrowerWethAta);
    expect(wethBal.value.amount).to.equal("900000000"); // 9 WETH remaining
    console.log("  borrower WETH remaining:", wethBal.value.uiAmountString);
  });
});
