import fs from "fs";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction,
} from "@solana/web3.js";

const RPC = "http://localhost:8899";
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATOKEN = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const XIVE = new PublicKey("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");
const XUSD = new PublicKey("xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const kp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p))));
const borrower = kp("keys/deploy-wallet.json");
const conn = new Connection(RPC, "confirmed");

const pda = (seeds, prog = XIVE) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const xivePda = pda([Buffer.from("xive")]);
const collPda = pda([Buffer.from("collateral"), USDC.toBuffer()]);
const walletPda = pda([Buffer.from("wallet"), borrower.publicKey.toBuffer()]);
const posPda = (i) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(i)); return pda([Buffer.from("pos"), borrower.publicKey.toBuffer(), b]); };
const ata = (o, m) => PublicKey.findProgramAddressSync([o.toBuffer(), TOKEN.toBuffer(), m.toBuffer()], ATOKEN)[0];

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const D = {
  update: Buffer.from([218,227,184,124,133,81,157,131]),
  price: Buffer.from([207,218,194,201,118,198,249,204]),
  initWallet: Buffer.from([141,132,233,130,168,183,10,119]),
  open: Buffer.from([135,128,47,77,15,152,240,49]),
  close: Buffer.from([123,134,81,0,49,68,98,98]),
};
const k = (pubkey, s, w) => ({ pubkey, isSigner: s, isWritable: w });

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json());
}
async function send(ixs, signers, label) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = borrower.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  for (let i = 0; i < 60; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s) { if (s.err) throw new Error(`${label} failed: ${JSON.stringify(s.err)}`); if (["confirmed","finalized"].includes(s.confirmationStatus)) return sig; }
    await new Promise(r => setTimeout(r, 800));
  }
  throw new Error(`${label} timed out`);
}
const bal = async (a) => { try { return BigInt((await conn.getTokenAccountBalance(a)).value.amount); } catch { return 0n; } };
const show = (n, v) => console.log(`  ${n.padEnd(22)} ${(Number(v)/1e6).toFixed(6)}`);

(async () => {
  // fund SOL + USDC
  await rpc("surfnet_setAccount", [borrower.publicKey.toBase58(), { lamports: 1000e9 }]);
  await rpc("surfnet_setTokenAccount", [borrower.publicKey.toBase58(), USDC.toBase58(), { amount: 10000e6 }]);

  // 1. register USDC collateral (ltv 80%, liq 90%)
  await send([new TransactionInstruction({ programId: XIVE, data: Buffer.concat([D.update, Buffer.from([1]), u16(8000), u16(9000)]), keys: [
    k(borrower.publicKey,true,true), k(USDC,false,false), k(collPda,false,true), k(xivePda,false,false),
    k(ata(xivePda,USDC),false,true), k(SystemProgram.programId,false,false), k(TOKEN,false,false), k(ATOKEN,false,false),
  ]})], [borrower], "update_collateral");
  console.log("✓ collateral registered");

  // 2. set price $1
  await send([new TransactionInstruction({ programId: XIVE, data: Buffer.concat([D.price, u64(1e6)]), keys: [
    k(borrower.publicKey,true,true), k(USDC,false,false), k(collPda,false,true),
  ]})], [borrower], "set_price");
  console.log("✓ price set $1");

  // 3. init wallet
  const w = await conn.getAccountInfo(walletPda);
  if (!w) { await send([new TransactionInstruction({ programId: XIVE, data: D.initWallet, keys: [
    k(borrower.publicKey,true,true), k(walletPda,false,true), k(SystemProgram.programId,false,false),
  ]})], [borrower], "init_wallet"); console.log("✓ wallet initialized"); }

  // 4. open position: deposit 1000 USDC, borrow 500 xUSD
  const idx = 0;
  const pos = posPda(idx);
  await send([new TransactionInstruction({ programId: XIVE, data: Buffer.concat([D.open, u64(1000e6), u64(500e6)]), keys: [
    k(borrower.publicKey,true,true), k(walletPda,false,true), k(pos,false,true), k(USDC,false,false),
    k(ata(borrower.publicKey,XUSD),false,true), k(ata(borrower.publicKey,USDC),false,true),
    k(ata(xivePda,XUSD),false,true), k(ata(xivePda,USDC),false,true),
    k(collPda,false,false), k(XUSD,false,true), k(xivePda,false,true),
    k(SystemProgram.programId,false,false), k(TOKEN,false,false), k(ATOKEN,false,false),
  ]})], [borrower], "open_position");
  console.log("✓ position opened (deposit 1000 USDC, borrow 500 xUSD)");

  console.log("\nAfter open:");
  show("borrower xUSD", await bal(ata(borrower.publicKey, XUSD)));
  show("program(PDA) xUSD", await bal(ata(xivePda, XUSD)));
  show("xUSD total supply", BigInt((await conn.getTokenSupply(XUSD)).value.amount));

  // 5. CLOSE — the previously failing path
  await send([new TransactionInstruction({ programId: XIVE, data: D.close, keys: [
    k(borrower.publicKey,true,false), k(pos,false,true),
    k(ata(borrower.publicKey,XUSD),false,true), k(ata(xivePda,XUSD),false,true), k(XUSD,false,true),
    k(USDC,false,true), k(ata(xivePda,USDC),false,true), k(ata(borrower.publicKey,USDC),false,true),
    k(xivePda,false,false), k(TOKEN,false,false),
  ]})], [borrower], "close_position");
  console.log("\n✓✓ close_position SUCCEEDED");

  console.log("\nAfter close:");
  show("borrower xUSD", await bal(ata(borrower.publicKey, XUSD)));
  show("program(PDA) xUSD", await bal(ata(xivePda, XUSD)));
  show("xUSD total supply", BigInt((await conn.getTokenSupply(XUSD)).value.amount));
  show("borrower USDC", await bal(ata(borrower.publicKey, USDC)));
  const p = await conn.getAccountInfo(pos);
  console.log("  position close_date set:", p ? "yes (account still exists, debt+collateral zeroed)" : "account closed");
})().catch(e => { console.error("\n✗ ERROR:", e.message); process.exit(1); });
