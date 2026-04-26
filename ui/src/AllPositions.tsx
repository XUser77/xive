import { useCallback, useEffect, useMemo, useState } from "react";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { fetchAllPositions, type Position } from "./positions";
import { fetchCollaterals, type Collateral } from "./collateral";
import { KNOWN_MINTS, XUSD_DECIMALS } from "./config";
import { buildVaultLiquidateIx } from "./vaultInstructions";

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

export function AllPositions({ refreshKey }: { refreshKey: number }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [items, setItems] = useState<Position[] | null>(null);
  const [collaterals, setCollaterals] = useState<Map<string, Collateral>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liquidating, setLiquidating] = useState<string | null>(null);
  const [liquidateError, setLiquidateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [positions, cols] = await Promise.all([
        fetchAllPositions(connection),
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
  }, [connection]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const liquidate = useCallback(
    async (position: Position) => {
      if (!publicKey) return;
      const key = position.address.toBase58();
      setLiquidating(key);
      setLiquidateError(null);
      try {
        const ix = await buildVaultLiquidateIx({
          connection,
          payer: publicKey,
          position: position.address,
          collateralMint: position.collateralMint,
          debt: position.loanAmount,
        });
        // Default 200k CU isn't enough for ATA inits + xive.liquidate + Orca TwoHopSwap +
        // xive.return_collateral on the same tx.
        const tx = new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
          .add(ix);
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
        await load();
      } catch (e) {
        setLiquidateError(e instanceof Error ? e.message : String(e));
      } finally {
        setLiquidating(null);
      }
    },
    [publicKey, sendTransaction, connection, load],
  );

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

  return (
    <section style={{ marginTop: 32 }}>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          All opened positions
        </h2>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error">Failed to load: {error}</div>}
      {liquidateError && (
        <div className="error">Liquidate failed: {liquidateError}</div>
      )}

      {!error && rows && rows.length === 0 && (
        <div className="empty">No open positions across all users.</div>
      )}

      {!error && rows && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Owner</th>
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
                <td className="mono" title={p.user.toBase58()}>
                  {shorten(p.user.toBase58(), 6)}
                </td>
                <td className="mono" title={p.address.toBase58()}>
                  {shorten(p.address.toBase58(), 6)}
                </td>
                <td>
                  <strong>{meta.symbol}</strong>
                </td>
                <td>
                  {formatBase(p.collateralAmount, meta.decimals)} {meta.symbol}
                </td>
                <td>{formatBase(p.loanAmount, XUSD_DECIMALS)} XUSD</td>
                <td>
                  {ltvPct != null ? (
                    <span className={`mono ${ltvTone}`}>
                      {ltvPct.toFixed(2)}%
                      {liquidationLtvPct != null && (
                        <span className="muted"> / {liquidationLtvPct}%</span>
                      )}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="refresh"
                    disabled={
                      ltvTone !== "bad" ||
                      !publicKey ||
                      liquidating === p.address.toBase58()
                    }
                    onClick={() => void liquidate(p)}
                  >
                    {liquidating === p.address.toBase58()
                      ? "Liquidating…"
                      : "Liquidate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!items && !error && <div className="loading">Fetching positions…</div>}
    </section>
  );
}
