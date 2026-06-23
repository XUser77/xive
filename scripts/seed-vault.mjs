// Seed the protocol vault's XUSD + USDC reserves on a local surfpool so swaps
// (vault::buy_usdc / buy_xusd) have liquidity to pay out. Dev-only — uses the
// surfnet_setTokenAccount cheat. Amount (whole tokens) optional, default 1,000,000.
import { PublicKey } from "@solana/web3.js";

const RPC = process.env.RPC_URL || "http://localhost:8899";
const AMOUNT = BigInt(process.argv[2] || "1000000"); // whole tokens, 6 decimals
const raw = Number(AMOUNT * 1_000_000n);

const VAULT_PROGRAM = new PublicKey("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");
const XUSD = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const vaultPda = PublicKey.findProgramAddressSync([Buffer.from("vault")], VAULT_PROGRAM)[0];

async function setToken(owner, mint, amount) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "surfnet_setTokenAccount",
      params: [owner.toBase58(), mint.toBase58(), { amount }],
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${mint.toBase58()}: ${j.error.message}`);
}

(async () => {
  console.log(`Seeding vault ${vaultPda.toBase58()} with ${AMOUNT} XUSD + ${AMOUNT} USDC on ${RPC}`);
  await setToken(vaultPda, XUSD, raw);
  await setToken(vaultPda, USDC, raw);
  console.log("Done. Vault reserves funded — swaps in both directions should now succeed.");
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
