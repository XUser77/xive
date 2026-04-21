import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Transaction,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import type { Collateral } from "./collateral";
import { KNOWN_MINTS, XUSD_DECIMALS } from "./config";
import {
  createUserStateIx,
  fetchUserCounter,
  openPositionIx,
} from "./xiveInstructions";

function parseDecimal(input: string, decimals: number): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("invalid number");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(`max ${decimals} decimal${decimals === 1 ? "" : "s"}`);
  }
  const raw = BigInt(whole + frac.padEnd(decimals, "0"));
  if (raw <= 0n) throw new Error("amount must be positive");
  return raw;
}

function formatBase(raw: bigint, decimals: number, maxFrac = 6): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  if (decimals === 0) return (neg ? "-" : "") + abs.toLocaleString("en-US");
  const padded = abs.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const frac = padded
    .slice(-decimals)
    .slice(0, Math.max(0, maxFrac))
    .replace(/0+$/, "");
  const wholeFmt = BigInt(whole).toLocaleString("en-US");
  return (neg ? "-" : "") + (frac ? `${wholeFmt}.${frac}` : wholeFmt);
}

function symbolOf(mint: string): string {
  return KNOWN_MINTS[mint]?.symbol ?? mint.slice(0, 4);
}

function decimalsOf(mint: string): number {
  return KNOWN_MINTS[mint]?.decimals ?? 0;
}

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; sig: string }
  | { kind: "err"; msg: string };

export function OpenPositionModal({
  collateral,
  onClose,
  onOpened,
}: {
  collateral: Collateral;
  onClose: () => void;
  onOpened?: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const mint = collateral.mint.toBase58();
  const symbol = symbolOf(mint);
  const collateralDecimals = decimalsOf(mint);

  const [collateralInput, setCollateralInput] = useState("");
  const [loanInput, setLoanInput] = useState("");
  const [counter, setCounter] = useState<bigint | null | "unknown">("unknown");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    fetchUserCounter(connection, publicKey)
      .then((c) => {
        if (!cancelled) setCounter(c);
      })
      .catch(() => {
        if (!cancelled) setCounter(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  const parsed = useMemo(() => {
    let collateralBase: bigint | null = null;
    let loanBase: bigint | null = null;
    let collateralErr: string | null = null;
    let loanErr: string | null = null;
    try {
      if (collateralInput.trim()) {
        collateralBase = parseDecimal(collateralInput, collateralDecimals);
      }
    } catch (e) {
      collateralErr = e instanceof Error ? e.message : "invalid";
    }
    try {
      if (loanInput.trim()) loanBase = parseDecimal(loanInput, XUSD_DECIMALS);
    } catch (e) {
      loanErr = e instanceof Error ? e.message : "invalid";
    }
    return { collateralBase, loanBase, collateralErr, loanErr };
  }, [collateralInput, loanInput, collateralDecimals]);

  const preview = useMemo(() => {
    const { collateralBase, loanBase } = parsed;
    if (collateralBase == null) return null;
    // price is configured as "USD per whole collateral token", so scale into
    // XUSD base units: (collateralBase / 10^collDec) * price * 10^XUSD_DEC
    const scaledRaw = collateralBase * collateral.price;
    const expDiff = collateralDecimals - XUSD_DECIMALS;
    const collateralValue =
      expDiff >= 0
        ? scaledRaw / 10n ** BigInt(expDiff)
        : scaledRaw * 10n ** BigInt(-expDiff);
    const maxLoan = (collateralValue * collateral.ltv) / 10000n;
    const liqMax = (collateralValue * collateral.liquidationLtv) / 10000n;
    const ltvBps =
      loanBase != null && collateralValue > 0n
        ? Number((loanBase * 10000n) / collateralValue)
        : null;
    const overMax = loanBase != null && loanBase > maxLoan;
    return { collateralValue, maxLoan, liqMax, ltvBps, overMax };
  }, [
    parsed,
    collateral.price,
    collateral.ltv,
    collateral.liquidationLtv,
    collateralDecimals,
  ]);

  const canSubmit =
    publicKey != null &&
    parsed.collateralBase != null &&
    parsed.loanBase != null &&
    parsed.collateralErr == null &&
    parsed.loanErr == null &&
    counter !== "unknown" &&
    phase.kind !== "sending" &&
    !(preview?.overMax ?? false);

  const submit = useCallback(async () => {
    if (!publicKey || !parsed.collateralBase || !parsed.loanBase) return;
    if (counter === "unknown") return;

    setPhase({ kind: "sending" });
    try {
      const tx = new Transaction();
      let effectiveCounter: bigint;
      if (counter == null) {
        tx.add(createUserStateIx(publicKey));
        effectiveCounter = 0n;
      } else {
        effectiveCounter = counter;
      }
      tx.add(
        openPositionIx({
          user: publicKey,
          collateralMint: collateral.mint,
          counter: effectiveCounter,
          collateralAmount: parsed.collateralBase,
          loanAmount: parsed.loanBase,
        }),
      );
      const sig = await sendTransactionWithConfirm(
        connection,
        tx,
        sendTransaction,
        publicKey,
      );
      setPhase({ kind: "ok", sig });
      onOpened?.();
    } catch (e) {
      setPhase({
        kind: "err",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }, [
    publicKey,
    parsed.collateralBase,
    parsed.loanBase,
    counter,
    collateral.mint,
    connection,
    sendTransaction,
    onOpened,
  ]);

  const counterLine =
    counter === "unknown"
      ? "checking user state…"
      : counter == null
        ? "will also run create_user_state (first position)"
        : `next position index: ${counter.toString()}`;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="modal open-pos"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-title">Open position — {symbol}</div>
        <div className="modal-hint">{counterLine}</div>

        <div className="field">
          <label>Deposit {symbol}</label>
          <input
            className="modal-input"
            autoFocus
            placeholder={`amount in ${symbol}`}
            value={collateralInput}
            onChange={(e) => setCollateralInput(e.target.value)}
            inputMode="decimal"
            disabled={phase.kind === "sending"}
          />
          {parsed.collateralErr && (
            <div className="modal-error">{parsed.collateralErr}</div>
          )}
        </div>

        <div className="field">
          <label>Borrow XUSD</label>
          <input
            className="modal-input"
            placeholder="amount in XUSD"
            value={loanInput}
            onChange={(e) => setLoanInput(e.target.value)}
            inputMode="decimal"
            disabled={phase.kind === "sending"}
          />
          {parsed.loanErr && <div className="modal-error">{parsed.loanErr}</div>}
        </div>

        <div className="preview">
          <div className="preview-row">
            <span>{symbol} price</span>
            <span className="mono">
              ${Number(collateral.price).toLocaleString("en-US")}
            </span>
          </div>
          <div className="preview-row">
            <span>Deposit</span>
            <span className="mono">
              {parsed.collateralBase != null
                ? `${formatBase(parsed.collateralBase, collateralDecimals)} ${symbol}`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>Borrow</span>
            <span className="mono">
              {parsed.loanBase != null
                ? `${formatBase(parsed.loanBase, XUSD_DECIMALS)} XUSD`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>Collateral value</span>
            <span className="mono">
              {preview
                ? `${formatBase(preview.collateralValue, XUSD_DECIMALS)} XUSD`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>Max borrow @ {Number(collateral.ltv) / 100}%</span>
            <span className="mono">
              {preview
                ? `${formatBase(preview.maxLoan, XUSD_DECIMALS)} XUSD`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>
              Liquidation @ {Number(collateral.liquidationLtv) / 100}%
            </span>
            <span className="mono">
              {preview
                ? `${formatBase(preview.liqMax, XUSD_DECIMALS)} XUSD`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>Position LTV</span>
            <span
              className={`mono ${
                preview?.overMax ? "bad" : preview?.ltvBps != null ? "ok" : ""
              }`}
            >
              {preview?.ltvBps != null
                ? `${(preview.ltvBps / 100).toFixed(2)}%`
                : "—"}
            </span>
          </div>
        </div>

        {preview?.overMax && (
          <div className="modal-error">
            Requested borrow exceeds max at {Number(collateral.ltv) / 100}% LTV.
          </div>
        )}

        {phase.kind === "err" && <div className="modal-error">{phase.msg}</div>}
        {phase.kind === "ok" && (
          <div className="modal-ok">
            Position opened. Tx: <span className="mono">{phase.sig}</span>
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
            disabled={!canSubmit}
          >
            {phase.kind === "sending" ? "Sending…" : "Open position"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function sendTransactionWithConfirm(
  connection: Connection,
  tx: Transaction,
  send: ReturnType<typeof useWallet>["sendTransaction"],
  payer: PublicKey,
): Promise<string> {
  tx.feePayer = payer;
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  const sig = await send(tx, connection);
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  return sig;
}
