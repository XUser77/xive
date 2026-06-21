#!/usr/bin/env bash
#
# Initialize the deployed Xive programs (one-shot `initialize` instructions).
#
#   xive::initialize(loan_fee)  -> creates the Xive singleton PDA + xUSD mint
#   vault::initialize()         -> creates the Vault singleton PDA + LP-xUSD mint
#
# These are NOT run by deployment — a freshly deployed program has no state.
# Run this once after deploy-programs.sh (or surfpool auto-deploy).
#
# Usage:
#   ./deploy-initialize.sh
#
# Environment overrides:
#   RPC_URL    target RPC                       (default: https://node.xusd.tima.kz)
#   WALLET     payer / fee payer keypair        (default: keys/deploy-wallet.json)
#   LOAN_FEE   xive origination fee, basis pts  (default: 50  = 0.50%)
#   FUND_SOL   SOL to ensure on the payer first (default: 100; 0 = skip funding)
#
# Idempotent: skips a program whose singleton account already exists.

set -euo pipefail
cd "$(dirname "$0")"

if [ -d "$HOME/.local/share/solana/install/active_release/bin" ]; then
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi

RPC_URL="${RPC_URL:-https://node.xusd.tima.kz}"
WALLET="${WALLET:-keys/deploy-wallet.json}"
LOAN_FEE="${LOAN_FEE:-50}"
FUND_SOL="${FUND_SOL:-100}"

command -v solana >/dev/null || { echo "error: solana CLI not found on PATH" >&2; exit 1; }
command -v node   >/dev/null || { echo "error: node not found on PATH" >&2; exit 1; }

# Required keypairs / IDLs.
for f in "$WALLET" keys/xusd-mint-keypair.json keys/vault-mint-keypair.json \
         keys/xive-token.json keys/ve-xive-token.json \
         target/idl/xive.json target/idl/vault.json target/idl/team.json; do
  [ -f "$f" ] || { echo "error: missing $f" >&2; exit 1; }
done

PAYER="$(solana address -k "$WALLET")"
echo "RPC:      $RPC_URL"
echo "Payer:    $PAYER  ($WALLET)"
echo "loan_fee: $LOAN_FEE bps"
echo

# Ensure the payer is funded on the surfnet (single-tx init is cheap, but the
# wallet may be empty after a fresh node start).
if [ "$FUND_SOL" != "0" ]; then
  lamports=$(( FUND_SOL * 1000000000 ))
  echo "Funding $PAYER with ${FUND_SOL} SOL via surfnet_setAccount…"
  curl -fsS "$RPC_URL" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"surfnet_setAccount\",\"params\":[\"$PAYER\",{\"lamports\":$lamports}]}" \
    >/dev/null || echo "  (surfnet_setAccount failed — continuing; init will fail if balance is too low)"
  echo "Balance:  $(solana balance -k "$WALLET" --url "$RPC_URL" 2>/dev/null || echo unknown)"
  echo
fi

NODE_PATH="$PWD/ui/node_modules" \
RPC_URL="$RPC_URL" WALLET="$WALLET" LOAN_FEE="$LOAN_FEE" \
node <<'NODE'
const fs = require("fs");
const {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} = require("@solana/web3.js");

const RPC = process.env.RPC_URL;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const XIVE_PROGRAM = new PublicKey("xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR");
const VAULT_PROGRAM = new PublicKey("xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK");
const TEAM_PROGRAM = new PublicKey("xtm3VMkqiNhP2rd74yZUzsXFZMyAJapmcP7HUSfwD4i");

const loadKp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const ata = (owner, mint) => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
const disc = (idlPath, name) => {
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`instruction '${name}' not found in ${idlPath}`);
  return Buffer.from(ix.discriminator);
};
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

// Send + confirm over HTTP only. We deliberately avoid sendAndConfirmTransaction
// because it confirms via a WebSocket signatureSubscribe, which the HTTPS/nginx
// proxy in front of surfpool doesn't forward (handshake 405). Poll instead.
async function send(conn, ix, signers) {
  const tx = new Transaction().add(ix);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  for (let i = 0; i < 60; i++) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const s = value[0];
    if (s) {
      if (s.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(s.err)}`);
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return sig;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out confirming ${sig}`);
}

(async () => {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKp(process.env.WALLET);
  const loanFee = parseInt(process.env.LOAN_FEE, 10);

  // ---- xive::initialize(loan_fee) ----
  const xivePda = PublicKey.findProgramAddressSync([Buffer.from("xive")], XIVE_PROGRAM)[0];
  if (await conn.getAccountInfo(xivePda)) {
    console.log(`xive:  already initialized (${xivePda.toBase58()}) — skipping`);
  } else {
    const xusdMint = loadKp("keys/xusd-mint-keypair.json");
    const ix = new TransactionInstruction({
      programId: XIVE_PROGRAM,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: xivePda, isSigner: false, isWritable: true },
        { pubkey: xusdMint.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("target/idl/xive.json", "initialize"), u16(loanFee)]),
    });
    const sig = await send(conn, ix, [payer, xusdMint]);
    console.log(`xive:  initialized — xive=${xivePda.toBase58()} xusd_mint=${xusdMint.publicKey.toBase58()}`);
    console.log(`       tx ${sig}`);
  }

  // ---- vault::initialize() ----
  const vaultPda = PublicKey.findProgramAddressSync([Buffer.from("vault")], VAULT_PROGRAM)[0];
  if (await conn.getAccountInfo(vaultPda)) {
    console.log(`vault: already initialized (${vaultPda.toBase58()}) — skipping`);
  } else {
    const lpMint = loadKp("keys/vault-mint-keypair.json");
    const ix = new TransactionInstruction({
      programId: VAULT_PROGRAM,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: lpMint.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: disc("target/idl/vault.json", "initialize"),
    });
    const sig = await send(conn, ix, [payer, lpMint]);
    console.log(`vault: initialized — vault=${vaultPda.toBase58()} lp_mint=${lpMint.publicKey.toBase58()}`);
    console.log(`       tx ${sig}`);
  }

  // ---- team::initialize() ----
  const teamPda = PublicKey.findProgramAddressSync([Buffer.from("team")], TEAM_PROGRAM)[0];
  if (await conn.getAccountInfo(teamPda)) {
    console.log(`team:  already initialized (${teamPda.toBase58()}) — skipping`);
  } else {
    const xiveMint = loadKp("keys/xive-token.json");
    const veXiveMint = loadKp("keys/ve-xive-token.json");
    const ix = new TransactionInstruction({
      programId: TEAM_PROGRAM,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: teamPda, isSigner: false, isWritable: true },
        { pubkey: xiveMint.publicKey, isSigner: true, isWritable: true },
        { pubkey: veXiveMint.publicKey, isSigner: true, isWritable: true },
        { pubkey: ata(payer.publicKey, xiveMint.publicKey), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: disc("target/idl/team.json", "initialize"),
    });
    const sig = await send(conn, ix, [payer, xiveMint, veXiveMint]);
    console.log(`team:  initialized — team=${teamPda.toBase58()} xive_mint=${xiveMint.publicKey.toBase58()} ve_xive_mint=${veXiveMint.publicKey.toBase58()}`);
    console.log(`       tx ${sig}`);
  }

  console.log("\nDone.");
})().catch((e) => { console.error("ERROR:", e.message || e); process.exit(1); });
NODE
