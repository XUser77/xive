import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import {
  IGNORE_CACHE,
  NO_TOKEN_EXTENSION_CONTEXT,
  PDAUtil,
  PoolUtil,
  PriceMath,
  TickUtil,
  WhirlpoolIx,
  increaseLiquidityQuoteByInputToken,
  swapQuoteByInputToken,
  type Whirlpool,
  type WhirlpoolAccountFetcherInterface,
  type WhirlpoolContext,
  type Position,
} from "@orca-so/whirlpools-sdk";
import { Percentage, type Instruction } from "@orca-so/common-sdk";
import Decimal from "decimal.js";

import {
  TOKEN_PROGRAM_ID,
  USDC_DECIMALS,
  USDC_MINT,
  WHIRLPOOL_PROGRAM_ID,
  XUSD_DECIMALS,
  XUSD_MINT,
} from "./config";
import { buildClient, getXusdUsdcPool } from "./orca";

type Side = "XUSD" | "USDC";

const LP_RANGE_TICKS = 100;
const SLIPPAGE = Percentage.fromFraction(1, 100);

function decimalsOf(side: Side): number {
  return side === "XUSD" ? XUSD_DECIMALS : USDC_DECIMALS;
}

function mintOf(side: Side): PublicKey {
  return side === "XUSD" ? XUSD_MINT : USDC_MINT;
}

async function buildInitTickArrayIxs(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  tickSpacing: number,
  ticks: number[],
): Promise<Instruction[]> {
  const starts = new Set<number>();
  for (const t of ticks) starts.add(TickUtil.getStartTickIndex(t, tickSpacing));
  const ixs: Instruction[] = [];
  for (const startTick of starts) {
    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpool, startTick);
    const info = await ctx.connection.getAccountInfo(tickArrayPda.publicKey);
    if (info) continue;
    ixs.push(
      WhirlpoolIx.initTickArrayIx(ctx.program, {
        whirlpool,
        tickArrayPda,
        startTick,
        funder: ctx.wallet.publicKey,
      }),
    );
  }
  return ixs;
}

function formatBaseUnits(raw: BN, decimals: number, maxFrac = 4): string {
  if (raw.isZero()) return "0";
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-decimals).slice(0, maxFrac).replace(/0+$/, "");
  const wholeFmt = BigInt(whole).toLocaleString("en-US");
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

function parseDecimal(input: string, decimals: number): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("invalid number");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`max ${decimals} decimals`);
  const raw = BigInt(whole + frac.padEnd(decimals, "0"));
  if (raw <= 0n) throw new Error("amount must be positive");
  return raw;
}

export function SwapTab() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  const [pool, setPool] = useState<Whirlpool | null>(null);
  const [poolErr, setPoolErr] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [refresh, setRefresh] = useState(0);

  const client = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    return buildClient(connection, publicKey, signTransaction, signAllTransactions);
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  const loadPool = useCallback(async () => {
    if (!client) return;
    setPoolErr(null);
    try {
      const p = await getXusdUsdcPool(client.client);
      setPool(p);
    } catch (e) {
      setPoolErr(e instanceof Error ? e.message : String(e));
      setPool(null);
    }
  }, [client]);

  const loadPositions = useCallback(async () => {
    if (!client || !publicKey || !pool) return;
    try {
      const parsed = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });
      const candidates = parsed.value.flatMap((a) => {
        const info = (a.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } }).parsed?.info;
        if (!info?.tokenAmount) return [];
        if (info.tokenAmount.amount !== "1" || info.tokenAmount.decimals !== 0) return [];
        if (!info.mint) return [];
        const mint = new PublicKey(info.mint);
        const pda = PDAUtil.getPosition(WHIRLPOOL_PROGRAM_ID, mint).publicKey;
        return [pda];
      });
      if (candidates.length === 0) {
        setPositions([]);
        return;
      }
      const positionMap = await client.client.getPositions(candidates, IGNORE_CACHE);
      const poolKey = pool.getAddress();
      const mine = Object.values(positionMap).filter(
        (p): p is Position => p != null && p.getData().whirlpool.equals(poolKey),
      );
      setPositions(mine);
    } catch (e) {
      // Silent — empty list on failure
      setPositions([]);
    }
  }, [client, connection, publicKey, pool]);

  useEffect(() => {
    void loadPool();
  }, [loadPool, refresh]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions, refresh]);

  if (!publicKey) {
    return <section><div className="empty">Connect a wallet to swap.</div></section>;
  }
  if (poolErr) {
    return (
      <section>
        <div className="error">Failed to load XUSD/USDC pool: {poolErr}</div>
        <button className="refresh" onClick={() => setRefresh((k) => k + 1)}>Retry</button>
      </section>
    );
  }
  if (!pool || !client) {
    return <section><div className="empty">Loading pool…</div></section>;
  }

  return (
    <section>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>Swap XUSD ⇄ USDC</h2>
        <button className="refresh" onClick={() => setRefresh((k) => k + 1)}>Refresh</button>
      </div>
      <PoolInfo pool={pool} />
      <SwapPanel
        pool={pool}
        fetcher={client.ctx.fetcher}
        onSuccess={() => setRefresh((k) => k + 1)}
      />
      <AddLiquidityPanel
        pool={pool}
        ctx={client.ctx}
        onSuccess={() => setRefresh((k) => k + 1)}
      />
      <PositionsPanel
        pool={pool}
        positions={positions}
        onSuccess={() => setRefresh((k) => k + 1)}
      />
    </section>
  );
}

function PoolInfo({ pool }: { pool: Whirlpool }) {
  const { connection } = useConnection();
  const data = pool.getData();
  const tokA = pool.getTokenAInfo();
  const tokB = pool.getTokenBInfo();
  const price = PriceMath.sqrtPriceX64ToPrice(data.sqrtPrice, tokA.decimals, tokB.decimals);
  const symA = tokA.mint.equals(XUSD_MINT) ? "XUSD" : "USDC";
  const symB = tokB.mint.equals(XUSD_MINT) ? "XUSD" : "USDC";

  const [reserves, setReserves] = useState<{ a: BN; b: BN } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [va, vb] = await Promise.all([
        connection.getTokenAccountBalance(data.tokenVaultA, "confirmed"),
        connection.getTokenAccountBalance(data.tokenVaultB, "confirmed"),
      ]);
      if (cancelled) return;
      setReserves({ a: new BN(va.value.amount), b: new BN(vb.value.amount) });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connection, data.tokenVaultA, data.tokenVaultB]);

  return (
    <div className="preview">
      <div className="preview-row">
        <span>Pair</span>
        <span className="mono">{symA} / {symB}</span>
      </div>
      <div className="preview-row">
        <span>Price (1 {symA} =)</span>
        <span className="mono">{price.toFixed(6)} {symB}</span>
      </div>
      <div className="preview-row">
        <span>Current tick</span>
        <span className="mono">{data.tickCurrentIndex}</span>
      </div>
      <div className="preview-row">
        <span>Reserves</span>
        <span className="mono">
          {reserves
            ? `${formatBaseUnits(reserves.a, tokA.decimals)} ${symA} · ${formatBaseUnits(reserves.b, tokB.decimals)} ${symB}`
            : "…"}
        </span>
      </div>
    </div>
  );
}

function SwapPanel({
  pool,
  fetcher,
  onSuccess,
}: {
  pool: Whirlpool;
  fetcher: WhirlpoolAccountFetcherInterface;
  onSuccess: () => void;
}) {
  const [from, setFrom] = useState<Side>("XUSD");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const to: Side = from === "XUSD" ? "USDC" : "XUSD";

  const submit = async () => {
    setMsg(null);
    let raw: bigint;
    try {
      raw = parseDecimal(amount, decimalsOf(from));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "invalid");
      return;
    }
    setBusy(true);
    try {
      const quote = await swapQuoteByInputToken(
        pool,
        mintOf(from),
        new BN(raw.toString()),
        SLIPPAGE,
        WHIRLPOOL_PROGRAM_ID,
        fetcher,
        IGNORE_CACHE,
      );
      const tx = await pool.swap(quote);
      const sig = await tx.buildAndExecute();
      setMsg(`Swapped. Tx ${sig}`);
      setAmount("");
      onSuccess();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="preview" style={{ marginTop: 16 }}>
      <div className="preview-row"><strong>Swap</strong></div>
      <div className="preview-row">
        <span>From</span>
        <button className="refresh" onClick={() => setFrom(to)}>
          {from} → {to}
        </button>
      </div>
      <input
        className="modal-input"
        placeholder={`amount in ${from}`}
        value={amount}
        inputMode="decimal"
        onChange={(e) => setAmount(e.target.value)}
        disabled={busy}
      />
      <div className="modal-actions" style={{ marginTop: 8 }}>
        <button
          className="refresh primary"
          onClick={() => void submit()}
          disabled={busy || amount.trim() === ""}
        >
          {busy ? "Swapping…" : "Swap"}
        </button>
      </div>
      {msg && <div className={msg.startsWith("Swapped") ? "modal-ok" : "modal-error"}>{msg}</div>}
    </div>
  );
}

function AddLiquidityPanel({
  pool,
  ctx,
  onSuccess,
}: {
  pool: Whirlpool;
  ctx: WhirlpoolContext;
  onSuccess: () => void;
}) {
  const [side, setSide] = useState<Side>("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setMsg(null);
    let raw: bigint;
    try {
      raw = parseDecimal(amount, decimalsOf(side));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "invalid");
      return;
    }
    setBusy(true);
    try {
      const data = pool.getData();
      const tickCurrent = data.tickCurrentIndex;
      const tickSpacing = data.tickSpacing;
      const alignedCurrent = Math.floor(tickCurrent / tickSpacing) * tickSpacing;
      const tickLower = alignedCurrent - LP_RANGE_TICKS * tickSpacing;
      const tickUpper = alignedCurrent + LP_RANGE_TICKS * tickSpacing;

      const quote = increaseLiquidityQuoteByInputToken(
        mintOf(side),
        new Decimal(raw.toString()).div(new Decimal(10).pow(decimalsOf(side))),
        tickLower,
        tickUpper,
        SLIPPAGE,
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      const { tx } = await pool.openPositionWithMetadata(tickLower, tickUpper, quote);

      const initIxs = await buildInitTickArrayIxs(
        ctx,
        pool.getAddress(),
        tickSpacing,
        [tickLower, tickUpper, alignedCurrent],
      );
      if (initIxs.length > 0) tx.prependInstructions(initIxs);

      const sig = await tx.buildAndExecute();
      setMsg(`Position opened. Tx ${sig}`);
      setAmount("");
      onSuccess();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="preview" style={{ marginTop: 16 }}>
      <div className="preview-row"><strong>Add Liquidity (50/50)</strong></div>
      <div className="preview-row muted" style={{ fontSize: 12 }}>
        <span>Range ±{LP_RANGE_TICKS} ticks around current price.</span>
      </div>
      <div className="preview-row">
        <span>Input side</span>
        <button className="refresh" onClick={() => setSide(side === "XUSD" ? "USDC" : "XUSD")}>
          {side}
        </button>
      </div>
      <input
        className="modal-input"
        placeholder={`amount in ${side}`}
        value={amount}
        inputMode="decimal"
        onChange={(e) => setAmount(e.target.value)}
        disabled={busy}
      />
      <div className="modal-actions" style={{ marginTop: 8 }}>
        <button
          className="refresh primary"
          onClick={() => void submit()}
          disabled={busy || amount.trim() === ""}
        >
          {busy ? "Adding…" : "Add Liquidity"}
        </button>
      </div>
      {msg && <div className={msg.startsWith("Position") ? "modal-ok" : "modal-error"}>{msg}</div>}
    </div>
  );
}

function PositionsPanel({
  pool,
  positions,
  onSuccess,
}: {
  pool: Whirlpool;
  positions: Position[];
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const close = async (position: Position) => {
    setMsg(null);
    setBusy(position.getAddress().toBase58());
    try {
      const txs = await pool.closePosition(position.getAddress(), SLIPPAGE);
      let lastSig = "";
      for (const tx of txs) {
        lastSig = await tx.buildAndExecute();
      }
      setMsg(`Closed. Tx ${lastSig}`);
      onSuccess();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const mintA = pool.getTokenAInfo().mint;
  const decA = pool.getTokenAInfo().decimals;
  const decB = pool.getTokenBInfo().decimals;
  const symA = mintA.equals(XUSD_MINT) ? "XUSD" : "USDC";
  const symB = symA === "XUSD" ? "USDC" : "XUSD";

  if (positions.length === 0) {
    return (
      <div className="preview" style={{ marginTop: 16 }}>
        <div className="preview-row"><strong>Your Positions</strong></div>
        <div className="preview-row muted">
          <span>No LP positions in this pool.</span>
        </div>
      </div>
    );
  }

  const poolData = pool.getData();
  return (
    <div className="preview" style={{ marginTop: 16 }}>
      <div className="preview-row"><strong>Your Positions</strong></div>
      <table className="table">
        <thead>
          <tr>
            <th>Range (ticks)</th>
            <th>Amounts</th>
            <th>Price range</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const d = p.getData();
            const priceLower = PriceMath.tickIndexToPrice(d.tickLowerIndex, decA, decB);
            const priceUpper = PriceMath.tickIndexToPrice(d.tickUpperIndex, decA, decB);
            const amounts = PoolUtil.getTokenAmountsFromLiquidity(
              d.liquidity,
              poolData.sqrtPrice,
              PriceMath.tickIndexToSqrtPriceX64(d.tickLowerIndex),
              PriceMath.tickIndexToSqrtPriceX64(d.tickUpperIndex),
              false,
            );
            const addr = p.getAddress().toBase58();
            return (
              <tr key={addr}>
                <td className="mono">{d.tickLowerIndex} → {d.tickUpperIndex}</td>
                <td className="mono">
                  {formatBaseUnits(amounts.tokenA, decA)} {symA} ·{" "}
                  {formatBaseUnits(amounts.tokenB, decB)} {symB}
                </td>
                <td className="mono">
                  {priceLower.toFixed(4)} – {priceUpper.toFixed(4)} {symB}/{symA}
                </td>
                <td>
                  <button
                    className="refresh"
                    onClick={() => void close(p)}
                    disabled={busy != null}
                  >
                    {busy === addr ? "Closing…" : "Close"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {msg && <div className={msg.startsWith("Closed") ? "modal-ok" : "modal-error"}>{msg}</div>}
    </div>
  );
}
