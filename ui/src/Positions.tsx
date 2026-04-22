import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { fetchUserPositions, type Position } from "./positions";
import { fetchCollaterals, type Collateral } from "./collateral";
import { KNOWN_MINTS, XUSD_DECIMALS } from "./config";
import {
  PositionActionModal,
  type PositionAction,
} from "./PositionActionModal";

function shorten(pk: string, n = 4): string {
  return `${pk.slice(0, n)}…${pk.slice(-n)}`;
}

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

function mintMeta(mint: string) {
  return KNOWN_MINTS[mint] ?? { symbol: shorten(mint), decimals: 0 };
}

const POSITION_ACTIONS: { action: PositionAction; label: string }[] = [
  { action: "repay", label: "Repay debt" },
  { action: "borrow", label: "Borrow more" },
  { action: "deposit_collateral", label: "Deposit collateral" },
  { action: "withdraw_collateral", label: "Withdraw collateral" },
];

function ActionsMenu({
  onPick,
}: {
  onPick: (action: PositionAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="refresh"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Actions ▾
      </button>
      {open && (
        <div className="dropdown-menu" role="menu">
          {POSITION_ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              className="dropdown-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(action);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Positions({ refreshKey }: { refreshKey: number }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [items, setItems] = useState<Position[] | null>(null);
  const [collaterals, setCollaterals] = useState<Map<string, Collateral>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    { action: PositionAction; position: Position } | null
  >(null);

  const load = useCallback(async () => {
    if (!publicKey) {
      setItems(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [positions, cols] = await Promise.all([
        fetchUserPositions(connection, publicKey),
        fetchCollaterals(connection),
      ]);
      const map = new Map<string, Collateral>();
      for (const c of cols) map.set(c.mint.toBase58(), c);
      setCollaterals(map);
      setItems(positions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const rows = useMemo(() => {
    if (!items) return null;
    return items.map((p) => {
      const mint = p.collateralMint.toBase58();
      const meta = mintMeta(mint);
      const col = collaterals.get(mint);
      let ltvPct: number | null = null;
      let ltvTone: "ok" | "warn" | "bad" = "ok";
      if (col && col.price > 0n) {
        const scaledRaw = p.collateralAmount * col.price;
        const expDiff = meta.decimals - XUSD_DECIMALS;
        const valueXusd =
          expDiff >= 0
            ? scaledRaw / 10n ** BigInt(expDiff)
            : scaledRaw * 10n ** BigInt(-expDiff);
        if (valueXusd > 0n) {
          const bps = Number((p.loanAmount * 10000n) / valueXusd);
          ltvPct = bps / 100;
          const scaled = p.loanAmount * 10000n;
          if (scaled >= valueXusd * col.liquidationLtv) ltvTone = "bad";
          else if (scaled >= valueXusd * col.ltv) ltvTone = "warn";
          else ltvTone = "ok";
        }
      }
      return {
        p,
        meta,
        ltvPct,
        ltvTone,
        liquidationLtvPct: col ? Number(col.liquidationLtv) / 100 : null,
      };
    });
  }, [items, collaterals]);

  if (!publicKey) return null;

  return (
    <section style={{ marginBottom: 32 }}>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          My positions
        </h2>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error">Failed to load: {error}</div>}

      {!error && rows && rows.length === 0 && (
        <div className="empty">No open positions.</div>
      )}

      {!error && rows && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Collateral</th>
              <th>Deposit</th>
              <th>Borrowed</th>
              <th>LTV</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, meta, ltvPct, ltvTone, liquidationLtvPct }) => (
              <tr key={p.address.toBase58()}>
                <td
                  className="mono"
                  title={p.address.toBase58()}
                >
                  {shorten(p.address.toBase58(), 6)}
                </td>
                <td>
                  <strong>{meta.symbol}</strong>
                </td>
                <td>
                  {formatBase(p.collateralAmount, meta.decimals)} {meta.symbol}
                </td>
                <td>
                  {formatBase(p.loanAmount, XUSD_DECIMALS)} XUSD
                </td>
                <td>
                  {ltvPct != null ? (
                    <span className={`mono ${ltvTone}`}>
                      {ltvPct.toFixed(2)}%
                      {liquidationLtvPct != null && (
                        <span className="muted">
                          {" "}
                          / {liquidationLtvPct}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <ActionsMenu
                    onPick={(action) => setModal({ action, position: p })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!items && !error && <div className="loading">Fetching positions…</div>}

      {modal && (
        <PositionActionModal
          action={modal.action}
          position={modal.position}
          collateral={
            collaterals.get(modal.position.collateralMint.toBase58()) ?? null
          }
          onClose={() => setModal(null)}
          onSuccess={() => void load()}
        />
      )}
    </section>
  );
}
