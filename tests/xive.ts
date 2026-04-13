import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import type { Xive } from "../target/types/xive.ts";
import type { PegKeeper } from "../target/types/peg_keeper.ts";
import type { Collateral } from "../target/types/collateral.ts";

const { PublicKey } = anchor.web3;

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Derive an Associated Token Account address */
function getATA(owner: anchor.web3.PublicKey, mint: anchor.web3.PublicKey): anchor.web3.PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}


describe("xive — take loan with WETH collateral (surfpool mainnet fork)", () => {
  // Initialized lazily in before() so test discovery works without a running validator
  let provider: anchor.AnchorProvider;
  let xiveProgram: Program<Xive>;
  let pegKeeperProgram: Program<PegKeeper>;
  let collateralProgram: Program<Collateral>;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    xiveProgram = anchor.workspace.xive as Program<Xive>;
    pegKeeperProgram = anchor.workspace.pegKeeper as Program<PegKeeper>;
    collateralProgram = anchor.workspace.collateral as Program<Collateral>;

  });

  it("Add collateral", () => {});

});
