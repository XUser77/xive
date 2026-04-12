import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Xive } from "../target/types/xive";

describe("xive", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.xive as Program<Xive>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
