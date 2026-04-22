import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type ParsedAccountData } from "@solana/web3.js";

import { KNOWN_MINTS, TOKEN_PROGRAM_ID, XUSD_MINT } from "./config";

function formatAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toLocaleString("en-US");
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  const wholeFmt = BigInt(whole).toLocaleString("en-US");
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

const DISPLAY_ORDER: { symbol: string; mint?: string; decimals: number }[] = [
  { symbol: "SOL", decimals: 9 },
  ...Object.entries(KNOWN_MINTS)
    .filter(([mint]) => mint !== XUSD_MINT.toBase58())
    .map(([mint, meta]) => ({ symbol: meta.symbol, mint, decimals: meta.decimals })),
  {
    symbol: "XUSD",
    mint: XUSD_MINT.toBase58(),
    decimals: KNOWN_MINTS[XUSD_MINT.toBase58()].decimals,
  },
];

export function WalletBalances({ refreshKey = 0 }: { refreshKey?: number }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState<bigint | null>(null);
  const [tokens, setTokens] = useState<Map<string, bigint>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) return;
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
      setTokens(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!publicKey) return null;

  return (
    <section className="balances-strip">
      {error && <div className="error">{error}</div>}
      <div className="balances-row">
        {DISPLAY_ORDER.map((entry) => {
          const raw =
            entry.mint == null ? sol ?? 0n : tokens.get(entry.mint) ?? 0n;
          return (
            <div className="balance-chip" key={entry.symbol}>
              <span className="balance-symbol">{entry.symbol}</span>
              <span className="balance-amount mono">
                {formatAmount(raw, entry.decimals)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
