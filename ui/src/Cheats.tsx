import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedAccountData,
} from "@solana/web3.js";

import { CollateralPrices } from "./CollateralPrices";
import { KNOWN_MINTS, XUSD_MINT } from "./config";
import { surfnetSetAccount, surfnetSetTokenAccount } from "./surfnet";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

type NativeRow = {
  kind: "native";
  symbol: "SOL";
  decimals: 9;
  unitLabel: "lamports";
  rawBalance: bigint;
};

type TokenRow = {
  kind: "token";
  symbol: string;
  mint: PublicKey;
  decimals: number;
  unitLabel: "base units";
  rawBalance: bigint;
};

type Row = NativeRow | TokenRow;

function formatAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function shorten(pk: string, n = 4): string {
  return `${pk.slice(0, n)}…${pk.slice(-n)}`;
}

type ModalTarget =
  | { kind: "native"; symbol: "SOL"; decimals: 9 }
  | { kind: "token"; symbol: string; mint: PublicKey; decimals: number };

function parseDecimal(input: string, decimals: number): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("invalid number");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(`max ${decimals} decimal${decimals === 1 ? "" : "s"}`);
  }
  const padded = frac.padEnd(decimals, "0");
  const raw = BigInt(whole + padded);
  if (raw <= 0n) throw new Error("amount must be positive");
  return raw;
}

function FundModal({
  target,
  owner,
  onClose,
  onSuccess,
}: {
  target: ModalTarget;
  owner: PublicKey;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    let raw: bigint;
    try {
      raw = parseDecimal(amount, target.decimals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "invalid number");
      return;
    }
    setBusy(true);
    try {
      if (target.kind === "native") {
        await surfnetSetAccount(owner, raw);
      } else {
        await surfnetSetTokenAccount(owner, target.mint, raw);
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rpcMethod =
    target.kind === "native" ? "surfnet_setAccount" : "surfnet_setTokenAccount";

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
        <div className="modal-title">Fund {target.symbol}</div>
        <div className="modal-hint">
          Sets wallet balance via <code>{rpcMethod}</code>. Enter amount in{" "}
          {target.symbol} (up to {target.decimals} decimal
          {target.decimals === 1 ? "" : "s"}).
        </div>
        <input
          className="modal-input"
          autoFocus
          placeholder={`amount in ${target.symbol}`}
          value={amount}
          inputMode="decimal"
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button className="refresh" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="refresh primary"
            onClick={() => void submit()}
            disabled={busy || amount.trim() === ""}
          >
            {busy ? "Sending…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Cheats() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const [sol, setSol] = useState<bigint | null>(null);
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalTarget | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const [lamports, parsed] = await Promise.all([
        connection.getBalance(publicKey, "confirmed"),
        connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_PROGRAM_ID,
        }),
      ]);
      const m = new Map<string, bigint>();
      for (const { account } of parsed.value) {
        const info = (account.data as ParsedAccountData).parsed?.info;
        if (!info) continue;
        const mint = info.mint as string;
        const raw = BigInt(info.tokenAmount?.amount ?? "0");
        m.set(mint, (m.get(mint) ?? 0n) + raw);
      }
      setSol(BigInt(lamports));
      setBalances(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [
      {
        kind: "native",
        symbol: "SOL",
        decimals: 9,
        unitLabel: "lamports",
        rawBalance: sol ?? 0n,
      },
    ];
    for (const [mintStr, meta] of Object.entries(KNOWN_MINTS)) {
      list.push({
        kind: "token",
        symbol: meta.symbol,
        mint: new PublicKey(mintStr),
        decimals: meta.decimals,
        unitLabel: "base units",
        rawBalance: balances.get(mintStr) ?? 0n,
      });
    }
    return list;
  }, [sol, balances]);

  if (!publicKey) {
    return (
      <section>
        <div className="empty">Connect a wallet to use cheats.</div>
      </section>
    );
  }

  return (
    <section>
      <div className="section-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Wallet balances
        </h2>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Wallet <span className="mono">{shorten(publicKey.toBase58(), 6)}</span>
        {" · "}
        Lamports are set via <code>surfnet_setAccount</code>, token balances via{" "}
        <code>surfnet_setTokenAccount</code>.
      </p>

      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Balance</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const humanBalance =
              r.kind === "native"
                ? `${formatAmount(r.rawBalance, 9)} SOL`
                : `${formatAmount(r.rawBalance, r.decimals)} ${r.symbol}`;
            return (
              <tr key={r.symbol + (r.kind === "token" ? r.mint.toBase58() : "")}>
                <td>
                  <strong>{r.symbol}</strong>
                  {r.kind === "native" && (
                    <span className="muted" style={{ marginLeft: 8 }}>
                      native
                    </span>
                  )}
                </td>
                <td>{humanBalance}</td>
                <td>
                  {!(r.kind === "token" && r.mint.equals(XUSD_MINT)) && (
                    <button
                      className="refresh"
                      onClick={() =>
                        setModal(
                          r.kind === "native"
                            ? { kind: "native", symbol: "SOL", decimals: 9 }
                            : {
                                kind: "token",
                                symbol: r.symbol,
                                mint: r.mint,
                                decimals: r.decimals,
                              },
                        )
                      }
                    >
                      Fund
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {modal && (
        <FundModal
          target={modal}
          owner={publicKey}
          onClose={() => setModal(null)}
          onSuccess={() => void load()}
        />
      )}

      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        1 SOL = {LAMPORTS_PER_SOL.toLocaleString()} lamports
      </p>

      <CollateralPrices />
    </section>
  );
}
