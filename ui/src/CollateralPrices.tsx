import { useCallback, useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { fetchCollaterals, type Collateral } from "./collateral";
import { KNOWN_MINTS } from "./config";
import { setPriceIx } from "./xiveInstructions";

function shorten(pk: string, n = 4): string {
  return `${pk.slice(0, n)}…${pk.slice(-n)}`;
}

function mintLabel(mint: string): string {
  return KNOWN_MINTS[mint]?.symbol ?? shorten(mint);
}

function parsePositiveInt(input: string): bigint {
  const s = input.trim();
  if (!/^\d+$/.test(s)) throw new Error("integer required");
  const v = BigInt(s);
  if (v <= 0n) throw new Error("must be positive");
  return v;
}

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; sig: string }
  | { kind: "err"; msg: string };

function SetPriceModal({
  collateral,
  onClose,
  onSuccess,
}: {
  collateral: Collateral;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const label = mintLabel(collateral.mint.toBase58());

  const submit = useCallback(async () => {
    if (!publicKey) return;
    let price: bigint;
    try {
      price = parsePositiveInt(input);
    } catch (e) {
      setPhase({
        kind: "err",
        msg: e instanceof Error ? e.message : "invalid",
      });
      return;
    }
    setPhase({ kind: "sending" });
    try {
      const tx = new Transaction();
      tx.add(
        setPriceIx({
          payer: publicKey,
          collateralMint: collateral.mint,
          price,
        }),
      );
      tx.feePayer = publicKey;
      const latest = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = latest.blockhash;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed",
      );
      setPhase({ kind: "ok", sig });
      onSuccess();
    } catch (e) {
      setPhase({
        kind: "err",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }, [publicKey, input, collateral.mint, connection, sendTransaction, onSuccess]);

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-title">Set {label} price</div>
        <div className="modal-hint">
          Current price:{" "}
          <span className="mono">
            ${Number(collateral.price).toLocaleString("en-US")}
          </span>
          . Enter new USD price (integer).
        </div>

        <input
          className="modal-input"
          autoFocus
          placeholder={collateral.price.toString()}
          value={input}
          inputMode="numeric"
          disabled={phase.kind === "sending"}
          onChange={(e) => {
            setInput(e.target.value);
            if (phase.kind === "err") setPhase({ kind: "idle" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />

        {phase.kind === "err" && <div className="modal-error">{phase.msg}</div>}
        {phase.kind === "ok" && (
          <div className="modal-ok">
            Price set. Tx: <span className="mono">{phase.sig}</span>
          </div>
        )}

        <div className="modal-actions">
          <button
            className="refresh"
            onClick={onClose}
            disabled={phase.kind === "sending"}
          >
            {phase.kind === "ok" ? "Close" : "Cancel"}
          </button>
          <button
            className="refresh primary"
            onClick={() => void submit()}
            disabled={
              !publicKey || input.trim() === "" || phase.kind === "sending"
            }
          >
            {phase.kind === "sending" ? "Sending…" : "Set price"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CollateralPrices() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [items, setItems] = useState<Collateral[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Collateral | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchCollaterals(connection));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section style={{ marginTop: 32 }}>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Set collateral price
        </h2>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Calls <code>set_price</code> on the xive program.
      </p>

      {error && <div className="error">Failed to load: {error}</div>}

      {!publicKey && (
        <div className="empty">Connect a wallet to set prices.</div>
      )}

      {publicKey && items && items.length === 0 && (
        <div className="empty">No collaterals registered.</div>
      )}

      {publicKey && items && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Current price</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const mint = c.mint.toBase58();
              return (
                <tr key={c.address.toBase58()}>
                  <td>
                    <strong>{mintLabel(mint)}</strong>
                  </td>
                  <td>${Number(c.price).toLocaleString("en-US")}</td>
                  <td>
                    <button
                      className="refresh primary"
                      onClick={() => setTarget(c)}
                    >
                      Set price
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!items && !error && <div className="loading">Fetching collaterals…</div>}

      {target && (
        <SetPriceModal
          collateral={target}
          onClose={() => setTarget(null)}
          onSuccess={() => void load()}
        />
      )}
    </section>
  );
}
