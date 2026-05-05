import { ReactNode, createContext, useCallback, useContext, useState } from "react";
import {
  ComputeBudgetProgram,
  Connection,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { color, font, radius } from "../ui/tokens";
import { MCard, PageFade, btnAccent, btnGhost, shortenAddr } from "../ui/primitives";

type Phase = "idle" | "pending" | "confirmed" | "failed";

type State = {
  phase: Phase;
  title: string;
  detailLines: [string, string][];
  sig?: string;
  error?: string;
  onClose?: () => void;
};

type SendArgs = {
  title: string;
  // human-readable summary lines for the status panel
  detailLines?: [string, string][];
  ixs: TransactionInstruction[];
  computeUnits?: number;
  onConfirmed?: () => void;
};

type Ctx = {
  send: (args: SendArgs) => Promise<string | null>;
  state: State;
};

const TxCtx = createContext<Ctx | null>(null);

export function TxProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [state, setState] = useState<State>({ phase: "idle", title: "", detailLines: [] });

  const send = useCallback<Ctx["send"]>(
    async ({ title, detailLines = [], ixs, computeUnits, onConfirmed }) => {
      if (!wallet.publicKey || !wallet.signTransaction) return null;
      setState({ phase: "pending", title, detailLines });
      try {
        const tx = new Transaction();
        if (computeUnits && computeUnits > 200_000) {
          tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
        }
        for (const ix of ixs) tx.add(ix);
        tx.feePayer = wallet.publicKey;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;

        const signed = await wallet.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        setState((s) => ({ ...s, sig }));

        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );

        setState({ phase: "confirmed", title, detailLines, sig });
        onConfirmed?.();
        return sig;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({ phase: "failed", title, detailLines, error: msg });
        return null;
      }
    },
    [connection, wallet],
  );

  const close = useCallback(() => {
    setState({ phase: "idle", title: "", detailLines: [] });
  }, []);

  return (
    <TxCtx.Provider value={{ send, state }}>
      {children}
      {state.phase !== "idle" && <TxStatusOverlay state={state} onClose={close} />}
    </TxCtx.Provider>
  );
}

export function useTxSender() {
  const ctx = useContext(TxCtx);
  if (!ctx) throw new Error("TxProvider missing");
  return ctx;
}

// ---------- Overlay ----------

function TxStatusOverlay({ state, onClose }: { state: State; onClose: () => void }) {
  const { phase, title, detailLines, sig, error } = state;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 6, 9, 0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 80,
        zIndex: 200,
      }}
    >
      <PageFade style={{ width: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: radius.pill,
              margin: "0 auto 22px",
              background: phase === "confirmed" ? color.accentDim : phase === "failed" ? "rgba(236,111,111,0.12)" : color.surface,
              border: `1px solid ${phase === "confirmed" ? color.accent : phase === "failed" ? color.red : color.borderHi}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {phase === "pending" && (
              <svg width="44" height="44" viewBox="0 0 44 44" style={{ animation: "mspin 1.4s linear infinite" }}>
                <circle cx="22" cy="22" r="17" fill="none" stroke={color.borderHi} strokeWidth="2" />
                <circle cx="22" cy="22" r="17" fill="none" stroke={color.accent} strokeWidth="2" strokeDasharray="35 110" strokeLinecap="round" />
              </svg>
            )}
            {phase === "confirmed" && <div style={{ fontSize: 34, color: color.accent, lineHeight: 1 }}>✓</div>}
            {phase === "failed" && <div style={{ fontSize: 34, color: color.red, lineHeight: 1 }}>✕</div>}
            <style>{`@keyframes mspin { to { transform: rotate(360deg); } }`}</style>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 500, margin: 0, letterSpacing: "-0.02em" }}>
            {phase === "pending" && `${title}…`}
            {phase === "confirmed" && `${title} — confirmed`}
            {phase === "failed" && `${title} — failed`}
          </h1>
          <div style={{ fontSize: 14, color: color.textDim, marginTop: 8, lineHeight: 1.5 }}>
            {phase === "pending" && "Usually takes 2–10 seconds on Solana."}
            {phase === "confirmed" && "Transaction included in a block."}
            {phase === "failed" && "Transaction did not land. Details below."}
          </div>
        </div>

        <MCard padding={16} style={{ marginBottom: 16 }}>
          {detailLines.map(([k, v], i) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "7px 0",
                fontSize: 12.5,
                borderBottom: i < detailLines.length - 1 ? `1px solid ${color.border}` : "none",
              }}
            >
              <span style={{ color: color.textDim }}>{k}</span>
              <span style={{ fontFamily: font.mono, color: color.text }}>{v}</span>
            </div>
          ))}
          {sig && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "7px 0",
                fontSize: 12.5,
                borderTop: detailLines.length ? `1px solid ${color.border}` : "none",
              }}
            >
              <span style={{ color: color.textDim }}>Signature</span>
              <a
                href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: font.mono, color: color.accent }}
              >
                {shortenAddr(sig, 6)} ↗
              </a>
            </div>
          )}
          {error && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                background: "rgba(236,111,111,0.08)",
                border: `1px solid rgba(236,111,111,0.25)`,
                borderRadius: radius.lg,
                color: color.red,
                fontSize: 12,
                fontFamily: font.mono,
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
          )}
        </MCard>

        <div style={{ display: "flex", gap: 8 }}>
          {phase === "pending" && (
            <button style={btnGhost({ flex: 1 })} onClick={onClose}>
              Hide
            </button>
          )}
          {(phase === "confirmed" || phase === "failed") && (
            <button style={btnAccent({ flex: 1, padding: "11px 0" })} onClick={onClose}>
              {phase === "confirmed" ? "Done" : "Close"}
            </button>
          )}
        </div>
      </PageFade>
    </div>
  );
}

// helper: wait for an account state predicate to flip after a tx confirms
export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  ms = 8_000,
  step = 400,
): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}

export type { Connection };
