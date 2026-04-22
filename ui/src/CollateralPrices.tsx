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

type RowState = {
  input: string;
  busy: boolean;
  error: string | null;
  ok: string | null;
};

const emptyRow: RowState = { input: "", busy: false, error: null, ok: null };

export function CollateralPrices() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [items, setItems] = useState<Collateral[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});

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

  const updateRow = (mint: string, patch: Partial<RowState>) => {
    setRows((prev) => ({
      ...prev,
      [mint]: { ...(prev[mint] ?? emptyRow), ...patch },
    }));
  };

  const submit = async (c: Collateral) => {
    if (!publicKey) return;
    const mint = c.mint.toBase58();
    const current = rows[mint] ?? emptyRow;
    let price: bigint;
    try {
      price = parsePositiveInt(current.input);
    } catch (e) {
      updateRow(mint, {
        error: e instanceof Error ? e.message : "invalid",
        ok: null,
      });
      return;
    }
    updateRow(mint, { busy: true, error: null, ok: null });
    try {
      const tx = new Transaction();
      tx.add(
        setPriceIx({
          payer: publicKey,
          collateralMint: c.mint,
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
      updateRow(mint, {
        busy: false,
        input: "",
        ok: `updated (${sig.slice(0, 8)}…)`,
      });
      await load();
    } catch (e) {
      updateRow(mint, {
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

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
        Calls <code>set_price</code> on the xive program. Requires the connected
        wallet to be the program's upgrade authority.
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
              <th>New price (USD, integer)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const mint = c.mint.toBase58();
              const row = rows[mint] ?? emptyRow;
              return (
                <tr key={c.address.toBase58()}>
                  <td>
                    <strong>{mintLabel(mint)}</strong>
                  </td>
                  <td>${Number(c.price).toLocaleString("en-US")}</td>
                  <td>
                    <input
                      className="modal-input"
                      style={{ maxWidth: 180 }}
                      placeholder={c.price.toString()}
                      value={row.input}
                      inputMode="numeric"
                      disabled={row.busy}
                      onChange={(e) =>
                        updateRow(mint, {
                          input: e.target.value,
                          error: null,
                          ok: null,
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submit(c);
                      }}
                    />
                    {row.error && (
                      <div className="modal-error" style={{ marginTop: 4 }}>
                        {row.error}
                      </div>
                    )}
                    {row.ok && (
                      <div className="modal-ok" style={{ marginTop: 4 }}>
                        {row.ok}
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      className="refresh primary"
                      onClick={() => void submit(c)}
                      disabled={row.busy || row.input.trim() === ""}
                    >
                      {row.busy ? "Sending…" : "Set price"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!items && !error && <div className="loading">Fetching collaterals…</div>}
    </section>
  );
}
