import { assert, expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

import {
  xiveProgram,
  vaultProgram,
  connection,
  payer,
  XUSD_MINT,
  USDC_MINT,
  LP_XUSD_MINT,
  XIVE_PROGRAM_ID,
  xivePda,
  vaultPda,
  ata,
  bn,
  giveXusd,
  newFundedKeypair,
  ataBalance,
  setTokenBalance,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SystemProgram,
} from "./helpers.js";

const ONE = 1_000_000; // 1 xUSD / USDC (6 decimals)
const MIN = 100_000n;
const INIT = 1_000_000n;

async function lpPrice(): Promise<bigint> {
  const x = await xiveProgram.account.xive.fetch(xivePda());
  const v = await vaultProgram.account.vault.fetch(vaultPda());
  const xusd = await ataBalance(vaultPda(), XUSD_MINT);
  const usdc = await ataBalance(vaultPda(), USDC_MINT);
  const supply = (await getMint(connection, LP_XUSD_MINT)).supply;

  const assets =
    xusd + usdc + BigInt(x.vaultBalance.toString()) -
    BigInt(v.xusdAssets.toString()) - BigInt(v.usdcAssets.toString());

  if (assets < 0n) return MIN;
  if (supply <= 0n) return INIT;
  const price = (assets * 1_000_000n) / supply;
  return price < MIN ? MIN : price;
}

describe("vault: transfer to/from xive", () => {
  it("transfer_from_xive mints xUSD into the vault and lowers vault_balance", async () => {
    const amount = 1000 * ONE;
    const x0 = await xiveProgram.account.xive.fetch(xivePda());
    const ata0 = await ataBalance(vaultPda(), XUSD_MINT);

    await vaultProgram.methods
      .transferFromXive(bn(amount))
      .accountsPartial({
        authority: payer.publicKey,
        vault: vaultPda(),
        xive: xivePda(),
        xusdMint: XUSD_MINT,
        vaultAta: ata(vaultPda(), XUSD_MINT),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        xiveProgram: XIVE_PROGRAM_ID,
      })
      .rpc();

    const x1 = await xiveProgram.account.xive.fetch(xivePda());
    expect((await ataBalance(vaultPda(), XUSD_MINT)) - ata0).to.eq(BigInt(amount));
    expect(
      BigInt(x0.vaultBalance.toString()) - BigInt(x1.vaultBalance.toString()),
    ).to.eq(BigInt(amount));
  });

  it("transfer_to_xive burns vault xUSD and raises vault_balance", async () => {
    const amount = 400 * ONE;
    const x0 = await xiveProgram.account.xive.fetch(xivePda());
    const ata0 = await ataBalance(vaultPda(), XUSD_MINT);

    await vaultProgram.methods
      .transferToXive(bn(amount))
      .accountsPartial({
        authority: payer.publicKey,
        vault: vaultPda(),
        xive: xivePda(),
        xusdMint: XUSD_MINT,
        vaultAta: ata(vaultPda(), XUSD_MINT),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        xiveProgram: XIVE_PROGRAM_ID,
      })
      .rpc();

    const x1 = await xiveProgram.account.xive.fetch(xivePda());
    expect(ata0 - (await ataBalance(vaultPda(), XUSD_MINT))).to.eq(BigInt(amount));
    expect(
      BigInt(x1.vaultBalance.toString()) - BigInt(x0.vaultBalance.toString()),
    ).to.eq(BigInt(amount));
  });
});

describe("vault: deposit / withdraw", () => {
  let investor: Keypair;

  async function deposit(xusd: number) {
    await vaultProgram.methods
      .deposit(bn(xusd), bn(0))
      .accountsPartial({
        investor: investor.publicKey,
        vault: vaultPda(),
        xive: xivePda(),
        lpXusdMint: LP_XUSD_MINT,
        xusdMint: XUSD_MINT,
        usdcMint: USDC_MINT,
        investorXusdAta: ata(investor.publicKey, XUSD_MINT),
        vaultXusdAta: ata(vaultPda(), XUSD_MINT),
        vaultUsdcAta: ata(vaultPda(), USDC_MINT),
        investorLpXusdAta: ata(investor.publicKey, LP_XUSD_MINT),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([investor])
      .rpc();
  }

  before(async function () {
    this.timeout(120000);
    investor = await newFundedKeypair();
    await giveXusd(investor.publicKey, 5000 * ONE);
    // the vault needs a USDC ATA to exist (read in the price calc)
    try {
      await setTokenBalance(vaultPda(), USDC_MINT, 0n);
    } catch {
      /* ignore on non-surfpool */
    }
  });

  it("mints LP shares for an xUSD deposit", async () => {
    const price = await lpPrice();
    const xusd = 2000 * ONE;
    const lp0 = await ataBalance(investor.publicKey, LP_XUSD_MINT);

    await deposit(xusd);

    const minted = (await ataBalance(investor.publicKey, LP_XUSD_MINT)) - lp0;
    const expected = (BigInt(xusd) * 1_000_000n) / price;
    // allow 1 unit of integer-division rounding
    assert.isTrue(minted >= expected - 1n && minted <= expected + 1n, `${minted} vs ${expected}`);
  });

  it("redeems xUSD for LP (minting the shortfall from xive if needed)", async () => {
    const lp = await ataBalance(investor.publicKey, LP_XUSD_MINT);
    const price = await lpPrice();
    const xusd0 = await ataBalance(investor.publicKey, XUSD_MINT);

    await vaultProgram.methods
      .withdraw(bn(lp), bn(0))
      .accountsPartial({
        investor: investor.publicKey,
        vault: vaultPda(),
        xive: xivePda(),
        lpXusdMint: LP_XUSD_MINT,
        xusdMint: XUSD_MINT,
        usdcMint: USDC_MINT,
        investorXusdAta: ata(investor.publicKey, XUSD_MINT),
        vaultXusdAta: ata(vaultPda(), XUSD_MINT),
        vaultUsdcAta: ata(vaultPda(), USDC_MINT),
        investorLpXusdAta: ata(investor.publicKey, LP_XUSD_MINT),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        xiveProgram: XIVE_PROGRAM_ID,
      })
      .signers([investor])
      .rpc();

    const got = (await ataBalance(investor.publicKey, XUSD_MINT)) - xusd0;
    const expected = (lp * price) / 1_000_000n;
    assert.isTrue(got >= expected - 2n, `redeemed ${got}, expected ~${expected}`);
    expect(await ataBalance(investor.publicKey, LP_XUSD_MINT)).to.eq(0n);
  });
});

describe("vault: swaps", () => {
  let swapper: Keypair;

  before(async function () {
    this.timeout(120000);
    swapper = await newFundedKeypair();
    // make sure the vault holds reserves of both legs
    await giveXusd(vaultPda(), 100_000 * ONE); // xUSD reserve for buy_xusd
    await setTokenBalance(vaultPda(), USDC_MINT, BigInt(100_000 * ONE)); // USDC reserve for buy_usdc
  });

  it("buy_xusd: pays USDC, receives xUSD minus the swap fee", async () => {
    const amount = 1000 * ONE;
    await setTokenBalance(swapper.publicKey, USDC_MINT, BigInt(amount));
    const v0 = await vaultProgram.account.vault.fetch(vaultPda());
    const xusd0 = await ataBalance(swapper.publicKey, XUSD_MINT);

    await vaultProgram.methods
      .buyXusd(bn(amount))
      .accountsPartial({
        swapper: swapper.publicKey,
        vault: vaultPda(),
        xusdMint: XUSD_MINT,
        usdcMint: USDC_MINT,
        vaultXusdAta: ata(vaultPda(), XUSD_MINT),
        vaultUsdcAta: ata(vaultPda(), USDC_MINT),
        swapperXusdAta: ata(swapper.publicKey, XUSD_MINT),
        swapperUsdcAta: ata(swapper.publicKey, USDC_MINT),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([swapper])
      .rpc();

    const fee = Math.floor((amount * 5) / 10_000); // SWAP_FEE = 5 bps
    const toPay = amount - fee;
    expect((await ataBalance(swapper.publicKey, XUSD_MINT)) - xusd0).to.eq(BigInt(toPay));

    const v1 = await vaultProgram.account.vault.fetch(vaultPda());
    expect(
      BigInt(v1.xusdAssets.toString()) - BigInt(v0.xusdAssets.toString()),
    ).to.eq(BigInt(Math.floor(fee / 5)));
  });

  it("buy_usdc: pays xUSD, receives USDC minus the swap fee", async () => {
    const amount = 1000 * ONE;
    await giveXusd(swapper.publicKey, amount);
    const v0 = await vaultProgram.account.vault.fetch(vaultPda());
    const usdc0 = await ataBalance(swapper.publicKey, USDC_MINT);

    await vaultProgram.methods
      .buyUsdc(bn(amount))
      .accountsPartial({
        swapper: swapper.publicKey,
        vault: vaultPda(),
        xusdMint: XUSD_MINT,
        usdcMint: USDC_MINT,
        vaultXusdAta: ata(vaultPda(), XUSD_MINT),
        vaultUsdcAta: ata(vaultPda(), USDC_MINT),
        swapperXusdAta: ata(swapper.publicKey, XUSD_MINT),
        swapperUsdcAta: ata(swapper.publicKey, USDC_MINT),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([swapper])
      .rpc();

    const fee = Math.floor((amount * 5) / 10_000);
    const toPay = amount - fee;
    expect((await ataBalance(swapper.publicKey, USDC_MINT)) - usdc0).to.eq(BigInt(toPay));

    const v1 = await vaultProgram.account.vault.fetch(vaultPda());
    expect(
      BigInt(v1.usdcAssets.toString()) - BigInt(v0.usdcAssets.toString()),
    ).to.eq(BigInt(Math.floor(fee / 5)));
  });
});
