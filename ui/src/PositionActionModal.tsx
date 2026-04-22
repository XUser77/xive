import { useCallback, useMemo, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import type { Collateral } from "./collateral";
import { KNOWN_MINTS, XUSD_DECIMALS } from "./config";
import type { Position } from "./positions";
import {
  borrowIx,
  depositCollateralIx,
  repayIx,
  withdrawCollateralIx,
} from "./xiveInstructions";

export type PositionAction =
  | "repay"
  | "borrow"
  | "deposit_collateral"
  | "withdraw_collateral";

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

function collateralValue(
  collateralAmount: bigint,
  price: bigint,
  collateralDecimals: number,
): bigint {
  const scaledRaw = collateralAmount * price;
  const expDiff = collateralDecimals - XUSD_DECIMALS;
  return expDiff >= 0
    ? scaledRaw / 10n ** BigInt(expDiff)
    : scaledRaw * 10n ** BigInt(-expDiff);
}

type ActionMeta = {
  title: string;
  hint: string;
  inputLabel: string;
  cta: string;
  unitSymbol: string;
  unitDecimals: number;
};

function actionMeta(action: PositionAction, collSymbol: string, collDecimals: number): ActionMeta {
  switch (action) {
    case "repay":
      return {
        title: "Repay debt",
        hint: "Burn XUSD from your wallet to reduce this position's loan.",
        inputLabel: "Repay XUSD",
        cta: "Repay",
        unitSymbol: "XUSD",
        unitDecimals: XUSD_DECIMALS,
      };
    case "borrow":
      return {
        title: "Borrow more",
        hint: "Mint additional XUSD against your existing collateral.",
        inputLabel: "Borrow XUSD",
        cta: "Borrow",
        unitSymbol: "XUSD",
        unitDecimals: XUSD_DECIMALS,
      };
    case "deposit_collateral":
      return {
        title: "Deposit collateral",
        hint: `Add more ${collSymbol} to this position.`,
        inputLabel: `Deposit ${collSymbol}`,
        cta: "Deposit",
        unitSymbol: collSymbol,
        unitDecimals: collDecimals,
      };
    case "withdraw_collateral":
      return {
        title: "Withdraw collateral",
        hint: `Pull ${collSymbol} out of this position. Subject to LTV check.`,
        inputLabel: `Withdraw ${collSymbol}`,
        cta: "Withdraw",
        unitSymbol: collSymbol,
        unitDecimals: collDecimals,
      };
  }
}

export function PositionActionModal({
  action,
  position,
  collateral,
  onClose,
  onSuccess,
}: {
  action: PositionAction;
  position: Position;
  collateral: Collateral | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const mint = position.collateralMint.toBase58();
  const collSymbol = symbolOf(mint);
  const collDecimals = decimalsOf(mint);
  const meta = actionMeta(action, collSymbol, collDecimals);

  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const parsed = useMemo(() => {
    if (!input.trim()) return { raw: null as bigint | null, err: null as string | null };
    try {
      return { raw: parseDecimal(input, meta.unitDecimals), err: null };
    } catch (e) {
      return {
        raw: null,
        err: e instanceof Error ? e.message : "invalid",
      };
    }
  }, [input, meta.unitDecimals]);

  const preview = useMemo(() => {
    if (parsed.raw == null) return null;
    const amt = parsed.raw;
    let newLoan = position.loanAmount;
    let newColl = position.collateralAmount;
    let problem: string | null = null;

    if (action === "repay") {
      if (amt > position.loanAmount) {
        problem = "Exceeds current loan.";
        newLoan = 0n;
      } else {
        newLoan = position.loanAmount - amt;
      }
    } else if (action === "borrow") {
      newLoan = position.loanAmount + amt;
    } else if (action === "deposit_collateral") {
      newColl = position.collateralAmount + amt;
    } else if (action === "withdraw_collateral") {
      if (amt > position.collateralAmount) {
        problem = "Exceeds current collateral.";
        newColl = 0n;
      } else {
        newColl = position.collateralAmount - amt;
      }
    }

    let ltvBps: number | null = null;
    let overMax = false;
    let overLiq = false;
    if (collateral && collateral.price > 0n) {
      const valueXusd = collateralValue(newColl, collateral.price, collDecimals);
      if (valueXusd > 0n) {
        ltvBps = Number((newLoan * 10000n) / valueXusd);
        overMax = newLoan * 10000n > valueXusd * collateral.ltv;
        overLiq = newLoan * 10000n > valueXusd * collateral.liquidationLtv;
      } else if (newLoan > 0n) {
        ltvBps = null;
        overMax = true;
        overLiq = true;
      }
    }
    return { newLoan, newColl, ltvBps, overMax, overLiq, problem };
  }, [parsed.raw, action, position.collateralAmount, position.loanAmount, collateral, collDecimals]);

  const blocked =
    preview?.problem != null ||
    ((action === "borrow" || action === "withdraw_collateral") &&
      (preview?.overMax ?? false));

  const submit = useCallback(async () => {
    if (!publicKey || parsed.raw == null) return;
    setPhase({ kind: "sending" });
    try {
      const tx = new Transaction();
      switch (action) {
        case "repay":
          tx.add(
            repayIx({
              user: publicKey,
              position: position.address,
              amount: parsed.raw,
            }),
          );
          break;
        case "borrow":
          tx.add(
            borrowIx({
              user: publicKey,
              position: position.address,
              collateralMint: position.collateralMint,
              amount: parsed.raw,
            }),
          );
          break;
        case "deposit_collateral":
          tx.add(
            depositCollateralIx({
              user: publicKey,
              position: position.address,
              collateralMint: position.collateralMint,
              amount: parsed.raw,
            }),
          );
          break;
        case "withdraw_collateral":
          tx.add(
            withdrawCollateralIx({
              user: publicKey,
              position: position.address,
              collateralMint: position.collateralMint,
              amount: parsed.raw,
            }),
          );
          break;
      }
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
  }, [publicKey, parsed.raw, action, position, connection, sendTransaction, onSuccess]);

  const ltvTone = preview?.overLiq
    ? "bad"
    : preview?.overMax
      ? "warn"
      : preview?.ltvBps != null
        ? "ok"
        : "";

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
        <div className="modal-title">
          {meta.title} — {collSymbol}
        </div>
        <div className="modal-hint">{meta.hint}</div>

        <div className="field">
          <label>{meta.inputLabel}</label>
          <input
            className="modal-input"
            autoFocus
            placeholder={`amount in ${meta.unitSymbol}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            inputMode="decimal"
            disabled={phase.kind === "sending"}
          />
          {parsed.err && <div className="modal-error">{parsed.err}</div>}
        </div>

        <div className="preview">
          <div className="preview-row">
            <span>Current collateral</span>
            <span className="mono">
              {formatBase(position.collateralAmount, collDecimals)} {collSymbol}
            </span>
          </div>
          <div className="preview-row">
            <span>Current loan</span>
            <span className="mono">
              {formatBase(position.loanAmount, XUSD_DECIMALS)} XUSD
            </span>
          </div>
          <div className="preview-row">
            <span>New collateral</span>
            <span className="mono">
              {preview
                ? `${formatBase(preview.newColl, collDecimals)} ${collSymbol}`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>New loan</span>
            <span className="mono">
              {preview
                ? `${formatBase(preview.newLoan, XUSD_DECIMALS)} XUSD`
                : "—"}
            </span>
          </div>
          <div className="preview-row">
            <span>New LTV</span>
            <span className={`mono ${ltvTone}`}>
              {preview?.ltvBps != null
                ? `${(preview.ltvBps / 100).toFixed(2)}%`
                : "—"}
              {collateral && (
                <span className="muted">
                  {" "}
                  / {Number(collateral.liquidationLtv) / 100}%
                </span>
              )}
            </span>
          </div>
        </div>

        {preview?.problem && <div className="modal-error">{preview.problem}</div>}
        {preview?.overMax && action === "borrow" && (
          <div className="modal-error">
            Would exceed max LTV ({Number(collateral?.ltv ?? 0n) / 100}%).
          </div>
        )}
        {preview?.overMax && action === "withdraw_collateral" && (
          <div className="modal-error">
            Remaining collateral would not cover the existing loan.
          </div>
        )}

        {phase.kind === "err" && <div className="modal-error">{phase.msg}</div>}
        {phase.kind === "ok" && (
          <div className="modal-ok">
            Done. Tx: <span className="mono">{phase.sig}</span>
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
              !publicKey ||
              parsed.raw == null ||
              parsed.err != null ||
              phase.kind === "sending" ||
              blocked
            }
          >
            {phase.kind === "sending" ? "Sending…" : meta.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
