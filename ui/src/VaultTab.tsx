import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import {
  LP_VAULT_DECIMALS,
  LP_VAULT_MINT,
  XUSD_DECIMALS,
  XUSD_MINT,
} from "./config";
import { ata, vaultPda } from "./pdas";
import { VaultActionModal } from "./VaultActionModal";

function formatBase(raw: bigint, decimals: number, maxFrac = 6): string {
  if (decimals === 0) return raw.toLocaleString("en-US");
  const padded = raw.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const frac = padded
    .slice(-decimals)
    .slice(0, Math.max(0, maxFrac))
    .replace(/0+$/, "");
  const wholeFmt = BigInt(whole).toLocaleString("en-US");
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true);
}

export function VaultTab() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [vaultXusd, setVaultXusd] = useState<bigint | null>(null);
  const [lpSupply, setLpSupply] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"deposit" | "withdraw" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vault = vaultPda();
      const vaultAta = ata(vault, XUSD_MINT);
      const [vaultAtaInfo, mintInfo] = await Promise.all([
        connection.getAccountInfo(vaultAta, "confirmed"),
        connection.getAccountInfo(LP_VAULT_MINT, "confirmed"),
      ]);

      // SPL Token Account: amount is u64 at offset 64
      if (vaultAtaInfo && vaultAtaInfo.data.length >= 72) {
        setVaultXusd(readU64LE(vaultAtaInfo.data, 64));
      } else {
        setVaultXusd(0n);
      }

      // SPL Mint: supply is u64 at offset 36 (4-byte mint_authority option + 32 pubkey)
      if (mintInfo && mintInfo.data.length >= 44) {
        setLpSupply(readU64LE(mintInfo.data, 36));
      } else {
        setLpSupply(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Vault
        </h2>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error">Failed to load: {error}</div>}

      {!error && (
        <div className="preview">
          <div className="preview-row">
            <span>Vault XUSD balance</span>
            <span className="mono">
              {vaultXusd != null
                ? `${formatBase(vaultXusd, XUSD_DECIMALS)} XUSD`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>LP vault tokens minted</span>
            <span className="mono">
              {lpSupply != null
                ? `${formatBase(lpSupply, LP_VAULT_DECIMALS)} LP`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>LP mint</span>
            <span className="mono" title={LP_VAULT_MINT.toBase58()}>
              {LP_VAULT_MINT.toBase58().slice(0, 6)}…
              {LP_VAULT_MINT.toBase58().slice(-6)}
            </span>
          </div>
        </div>
      )}

      <div className="modal-actions" style={{ marginTop: 16, justifyContent: "flex-start" }}>
        <button
          className="refresh primary"
          onClick={() => setModal("deposit")}
          disabled={!publicKey}
        >
          Deposit
        </button>
        <button
          className="refresh"
          onClick={() => setModal("withdraw")}
          disabled={!publicKey}
        >
          Withdraw
        </button>
      </div>

      {!publicKey && (
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Connect a wallet to deposit or withdraw.
        </p>
      )}

      {modal && (
        <VaultActionModal
          action={modal}
          onClose={() => setModal(null)}
          onSuccess={() => void load()}
        />
      )}
    </section>
  );
}
