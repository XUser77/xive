import { useCallback, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { LP_VAULT_DECIMALS, XUSD_DECIMALS } from "./config";
import { vaultDepositIx, vaultWithdrawIx } from "./vaultInstructions";

type Action = "deposit" | "withdraw";

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

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; sig: string }
  | { kind: "err"; msg: string };

export function VaultActionModal({
  action,
  onClose,
  onSuccess,
}: {
  action: Action;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const isDeposit = action === "deposit";
  const decimals = isDeposit ? XUSD_DECIMALS : LP_VAULT_DECIMALS;
  const symbol = isDeposit ? "XUSD" : "LP";
  const title = isDeposit ? "Deposit XUSD" : "Withdraw from vault";
  const hint = isDeposit
    ? "Deposit XUSD into the vault. You receive LP tokens in return."
    : "Burn LP tokens to withdraw your XUSD share from the vault.";

  const submit = useCallback(async () => {
    if (!publicKey) return;
    let raw: bigint;
    try {
      raw = parseDecimal(amount, decimals);
    } catch (e) {
      setPhase({
        kind: "err",
        msg: e instanceof Error ? e.message : "invalid number",
      });
      return;
    }
    setPhase({ kind: "sending" });
    try {
      const tx = new Transaction();
      tx.add(
        isDeposit
          ? vaultDepositIx({ user: publicKey, amount: raw })
          : vaultWithdrawIx({ user: publicKey, lpAmount: raw }),
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
      onSuccess?.();
    } catch (e) {
      setPhase({
        kind: "err",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }, [publicKey, amount, decimals, isDeposit, connection, sendTransaction, onSuccess]);

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
        <div className="modal-title">{title}</div>
        <div className="modal-hint">{hint}</div>

        <input
          className="modal-input"
          autoFocus
          placeholder={`amount in ${symbol}`}
          value={amount}
          inputMode="decimal"
          disabled={phase.kind === "sending"}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />

        {phase.kind === "err" && <div className="modal-error">{phase.msg}</div>}
        {phase.kind === "ok" && (
          <div className="modal-ok">
            Confirmed. Tx: <span className="mono">{phase.sig}</span>
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
              amount.trim() === "" ||
              phase.kind === "sending"
            }
          >
            {phase.kind === "sending"
              ? "Sending…"
              : isDeposit
                ? "Deposit"
                : "Withdraw"}
          </button>
        </div>
      </div>
    </div>
  );
}
