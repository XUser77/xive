import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { fetchCollaterals, type Collateral } from "./collateral";
import { KNOWN_MINTS } from "./config";
import { OpenPositionModal } from "./OpenPositionModal";

function shorten(pk: string, n = 4): string {
  return `${pk.slice(0, n)}…${pk.slice(-n)}`;
}

function formatBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function formatPrice(price: bigint, mint: string): string {
  const meta = KNOWN_MINTS[mint];
  if (!meta) return price.toString();
  return `$${Number(price).toLocaleString("en-US")}`;
}

function formatDate(unix: bigint): string {
  const n = Number(unix);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString();
}

function mintLabel(mint: string): string {
  return KNOWN_MINTS[mint]?.symbol ?? shorten(mint);
}

export function CollateralList({
  onPositionOpened,
}: {
  onPositionOpened?: () => void;
} = {}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [items, setItems] = useState<Collateral[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<Collateral | null>(null);

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

  const showAction = useMemo(() => Boolean(publicKey), [publicKey]);

  return (
    <section>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Allowed collaterals
        </h2>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error">Failed to load: {error}</div>}

      {!error && items && items.length === 0 && (
        <div className="empty">No collaterals registered yet.</div>
      )}

      {!error && items && items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Mint</th>
              <th>LTV</th>
              <th>Liq. LTV</th>
              <th>Price</th>
              <th>Status</th>
              <th>Updated</th>
              {showAction && <th></th>}
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
                  <td className="mono" title={mint}>
                    {shorten(mint, 6)}
                  </td>
                  <td>{formatBps(c.ltv)}</td>
                  <td>{formatBps(c.liquidationLtv)}</td>
                  <td>{formatPrice(c.price, mint)}</td>
                  <td>
                    <span className={`pill ${c.allowed ? "ok" : "bad"}`}>
                      {c.allowed ? "allowed" : "disabled"}
                    </span>
                  </td>
                  <td className="muted">{formatDate(c.priceDate)}</td>
                  {showAction && (
                    <td>
                      <button
                        className="refresh primary"
                        disabled={!c.allowed}
                        onClick={() => setOpening(c)}
                      >
                        Open position
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!items && !error && <div className="loading">Fetching accounts…</div>}

      {!publicKey && items && items.length > 0 && (
        <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
          Connect a wallet to open a position against a collateral.
        </p>
      )}

      {opening && (
        <OpenPositionModal
          collateral={opening}
          onClose={() => setOpening(null)}
          onOpened={onPositionOpened}
        />
      )}
    </section>
  );
}
