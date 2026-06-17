import { assert, expect } from "chai";
import {
  Keypair,
  PublicKey,
  AccountMeta,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";

import {
  xiveProgram,
  vaultProgram,
  connection,
  payer,
  XUSD_MINT,
  USDC_MINT,
  JUPITER_PROGRAM_ID,
  xivePda,
  vaultPda,
  walletPda,
  positionPda,
  collateralPda,
  ata,
  bn,
  newFundedKeypair,
  ataBalance,
  accountExists,
  setTokenBalance,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SystemProgram,
} from "./helpers.js";

// liquid mainnet collateral with deep Jupiter -> USDC liquidity on the fork
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const WSOL_DECIMALS = 9;
const ONE_WSOL = 10 ** WSOL_DECIMALS;
const ONE_USD = 1_000_000;

const LTV = 5000;
const LIQ_LTV = 8000;
const JUP = "https://quote-api.jup.ag/v6";

const toMeta = (a: any): AccountMeta => ({
  pubkey: new PublicKey(a.pubkey),
  isSigner: a.isSigner,
  isWritable: a.isWritable,
});

async function getLookupTables(addrs: string[]): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  for (const a of addrs) {
    const res = await connection.getAddressLookupTable(new PublicKey(a));
    if (res.value) out.push(res.value);
  }
  return out;
}

describe("vault: liquidation via Jupiter (mainnet-fork)", () => {
  let borrower: Keypair;
  let position: PublicKey;
  let jupiterReachable = true;

  before(async function () {
    this.timeout(180000);

    // sanity: Jupiter API + the USDC cheatcode must be available, else skip the suite
    try {
      const ping = await fetch(
        `${JUP}/quote?inputMint=${WSOL.toBase58()}&outputMint=${USDC_MINT.toBase58()}&amount=1000000&swapMode=ExactIn`,
      );
      if (!ping.ok) jupiterReachable = false;
    } catch {
      jupiterReachable = false;
    }
    if (!jupiterReachable) return;

    borrower = await newFundedKeypair();

    // enable wSOL as collateral, priced at $150
    await xiveProgram.methods
      .updateCollateral(true, LTV, LIQ_LTV)
      .accountsPartial({
        authority: payer.publicKey,
        mint: WSOL,
        collateral: collateralPda(WSOL),
        xive: xivePda(),
        programCollateralAta: ata(xivePda(), WSOL),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    await xiveProgram.methods
      .setCollateralPrice(bn(150 * ONE_USD))
      .accountsPartial({ authority: payer.publicKey, mint: WSOL, collateral: collateralPda(WSOL) })
      .rpc();

    // fund 10 wSOL and open a position borrowing 750 xUSD (50% of $1500)
    await setTokenBalance(borrower.publicKey, WSOL, BigInt(10 * ONE_WSOL));
    if (!(await accountExists(walletPda(borrower.publicKey)))) {
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
    position = positionPda(borrower.publicKey, 0);
    await xiveProgram.methods
      .openPosition(bn(10 * ONE_WSOL), bn(750 * ONE_USD))
      .accountsPartial({
        borrower: borrower.publicKey,
        wallet: walletPda(borrower.publicKey),
        position,
        collateralMint: WSOL,
        borrowerXusdAta: ata(borrower.publicKey, XUSD_MINT),
        borrowerCollateralAta: ata(borrower.publicKey, WSOL),
        programCollateralAta: ata(xivePda(), WSOL),
        collateral: collateralPda(WSOL),
        xusdMint: XUSD_MINT,
        xive: xivePda(),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // crash the price to $90 so bps (~8333) >= liquidation_ltv (8000)
    await xiveProgram.methods
      .setCollateralPrice(bn(90 * ONE_USD))
      .accountsPartial({ authority: payer.publicKey, mint: WSOL, collateral: collateralPda(WSOL) })
      .rpc();
  });

  it("liquidates: seizes collateral, swaps to USDC (debt+5%), returns the rest", async function () {
    if (!jupiterReachable) this.skip();
    this.timeout(180000);

    const pos = await xiveProgram.account.position.fetch(position);
    const loan = BigInt(pos.loanAmount.toString());
    const requiredUsdc = (loan * 105n) / 100n; // debt + 5%

    // 1) Jupiter ExactOut route (wSOL -> USDC) authored for the vault PDA
    const quote = await (
      await fetch(
        `${JUP}/quote?inputMint=${WSOL.toBase58()}&outputMint=${USDC_MINT.toBase58()}` +
          `&amount=${requiredUsdc.toString()}&swapMode=ExactOut&slippageBps=300`,
      )
    ).json();

    const swapIxResp = await (
      await fetch(`${JUP}/swap-instructions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: vaultPda().toBase58(),
          wrapAndUnwrapSol: false,
          useSharedAccounts: true,
        }),
      })
    ).json();

    const swapIx = swapIxResp.swapInstruction;
    expect(new PublicKey(swapIx.programId).equals(JUPITER_PROGRAM_ID)).to.eq(true);

    const usdcBefore = await ataBalance(vaultPda(), USDC_MINT);

    // 2) assemble vault.liquidate, forwarding the Jupiter accounts/data
    const liqIx = await vaultProgram.methods
      .liquidate(Buffer.from(swapIx.data, "base64"))
      .accountsPartial({
        liquidator: payer.publicKey,
        vault: vaultPda(),
        xive: xivePda(),
        position,
        collateral: collateralPda(WSOL),
        collateralMint: WSOL,
        xiveCollateralAta: ata(xivePda(), WSOL),
        vaultCollateralAta: ata(vaultPda(), WSOL),
        usdcMint: USDC_MINT,
        vaultUsdcAta: ata(vaultPda(), USDC_MINT),
        jupiterProgram: JUPITER_PROGRAM_ID,
        xiveProgram: xiveProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts((swapIx.accounts as any[]).map(toMeta))
      .instruction();

    const luts = await getLookupTables(swapIxResp.addressLookupTableAddresses ?? []);
    const blockhash = (await connection.getLatestBlockhash()).blockhash;
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [liqIx],
    }).compileToV0Message(luts);
    const vtx = new VersionedTransaction(msg);
    vtx.sign([payer]);
    const sig = await connection.sendTransaction(vtx);
    await connection.confirmTransaction(sig, "confirmed");

    // 3) assertions
    const after = await xiveProgram.account.position.fetch(position);
    expect(after.loanAmount.toString()).to.eq("0");
    expect(after.closeDate.toString()).to.not.eq("0");
    // surplus collateral returned to the borrower's claim
    assert.isTrue(BigInt(after.collateralAmount.toString()) > 0n);
    // vault received at least debt + 5% in USDC
    assert.isTrue((await ataBalance(vaultPda(), USDC_MINT)) - usdcBefore >= requiredUsdc);
  });
});
