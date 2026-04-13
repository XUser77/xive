import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import type { Xive } from "../target/types/xive.ts";
import type { PegKeeper } from "../target/types/peg_keeper.ts";
import type { Collateral } from "../target/types/collateral.ts";

const { PublicKey, Keypair } = anchor.web3;

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

  it("Empty", () => {});

});
