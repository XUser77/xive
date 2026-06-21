import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { KNOWN_MINTS, XUSD_MINT, LP_VAULT_MINT } from "../config";
import { ata, vaultPda } from "../pdas";
import { fetchUserPositions, type Position } from "../positions";
import { fetchCollaterals, type Collateral } from "../collateral";
import { fetchWalletIndex } from "../xiveInstructions";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type WalletBalance = {
  mint: string; // base58, or "SOL"
  symbol: string;
  decimals: number;
  rawBalance: bigint;
};

export type UserData = {
  positions: Position[];
  balances: WalletBalance[];
  vaultLpBalance: bigint;
  vaultXusdTotal: bigint;
  walletIndex: bigint | null;
  collaterals: Collateral[];
  loading: boolean;
  refresh: () => void;
};

const DEFAULT: UserData = {
  positions: [],
  balances: [],
  vaultLpBalance: 0n,
  vaultXusdTotal: 0n,
  walletIndex: null,
  collaterals: [],
  loading: false,
  refresh: () => {},
};

export function useUserData(): UserData {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [data, setData] = useState<UserData>(DEFAULT);
  const [bump, setBump] = useState(0);

  const refresh = useCallback(() => setBump((b) => b + 1), []);

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true, refresh }));

    (async () => {
      try {
        // Collaterals registry is public — fetch even when disconnected.
        const collaterals = await fetchCollaterals(connection);

        if (!connected || !publicKey) {
          if (!cancelled) {
            setData({ ...DEFAULT, collaterals, loading: false, refresh });
          }
          return;
        }

        const [
          positions,
          parsed,
          solLamports,
          vaultLpInfo,
          vaultXusdInfo,
          walletIndex,
        ] = await Promise.all([
          fetchUserPositions(connection, publicKey),
          connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
          connection.getBalance(publicKey, "confirmed"),
          connection.getTokenAccountBalance(ata(publicKey, LP_VAULT_MINT)).catch(() => null),
          connection.getTokenAccountBalance(ata(vaultPda(), XUSD_MINT)).catch(() => null),
          fetchWalletIndex(connection, publicKey).catch(() => null),
        ]);

        const balances: WalletBalance[] = [
          {
            mint: "SOL",
            symbol: "SOL",
            decimals: 9,
            rawBalance: BigInt(solLamports),
          },
        ];
        for (const acc of parsed.value) {
          const info = acc.account.data.parsed.info;
          const mint = info.mint as string;
          const known = KNOWN_MINTS[mint];
          balances.push({
            mint,
            symbol: known?.symbol ?? mint.slice(0, 4),
            decimals: info.tokenAmount.decimals,
            rawBalance: BigInt(info.tokenAmount.amount),
          });
        }

        if (!cancelled) {
          setData({
            positions,
            balances,
            vaultLpBalance: vaultLpInfo ? BigInt(vaultLpInfo.value.amount) : 0n,
            vaultXusdTotal: vaultXusdInfo ? BigInt(vaultXusdInfo.value.amount) : 0n,
            walletIndex,
            collaterals,
            loading: false,
            refresh,
          });
        }
      } catch (e) {
        console.warn("useUserData refresh failed", e);
        if (!cancelled) setData((d) => ({ ...d, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, connected, publicKey, bump, refresh]);

  return data;
}

// ---------- helpers ----------

export function balanceOf(balances: WalletBalance[], mint: string | "SOL"): WalletBalance | undefined {
  return balances.find((b) => b.mint === mint);
}

export function rawToWhole(raw: bigint, decimals: number): number {
  if (decimals === 0) return Number(raw);
  return Number(raw) / Math.pow(10, decimals);
}

export function wholeToRaw(whole: number, decimals: number): bigint {
  if (Number.isNaN(whole) || whole < 0) return 0n;
  const fixed = whole.toFixed(decimals);
  const [w, f = ""] = fixed.split(".");
  return BigInt(w + f.padEnd(decimals, "0"));
}

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}
