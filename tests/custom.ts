import {COLLATERALS, setupProtocol} from "./hooks.js";
import * as anchor from "@anchor-lang/core";
import {BN, Program} from "@anchor-lang/core";
import type { Xive } from "../target/types/xive.ts";
import type { Collaterals } from "../target/types/collaterals.ts";
import { getCollateral } from "./utils.js";
import {PublicKey} from "@solana/web3.js";
import {expect} from "chai";

describe("Custom tests", () => {
  let provider: anchor.AnchorProvider;

  let xiveProgram: Program<Xive>;
  let collateralsProgram: Program<Collaterals>;

  before(async () => {
    await setupProtocol();

    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    xiveProgram = anchor.workspace.xive as Program<Xive>;
    collateralsProgram = anchor.workspace.collaterals as Program<Collaterals>;
  });

  it("Check collaterals", async () => {
    const weth = await getCollateral(
      collateralsProgram,
      new PublicKey(COLLATERALS.WETH.mint)
    );
    const wbtc = await getCollateral(
      collateralsProgram,
      new PublicKey(COLLATERALS.WBTC.mint)
    );
    expect(weth.mint.toBase58()).to.equal(COLLATERALS.WETH.mint);
    expect(weth.ltv.toString()).to.equal(COLLATERALS.WETH.tvl.toString());
    expect(weth.liquidationLtv.toString()).to.equal(COLLATERALS.WETH.liqTvl.toString());
    expect(weth.allowed).to.equal(true);

    expect(wbtc.mint.toBase58()).to.equal(COLLATERALS.WBTC.mint);
    expect(wbtc.ltv.toString()).to.equal(COLLATERALS.WBTC.tvl.toString());
    expect(wbtc.liquidationLtv.toString()).to.equal(COLLATERALS.WBTC.liqTvl.toString());
    expect(wbtc.allowed).to.equal(true);


  });

  it ("Check collaterals price", async () => {
    // collateralsProgram.methods
    //   .setPrice()
  });

});