import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";

import { RPC_ENDPOINT } from "./config";

import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletProviders({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
      new BackpackWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider
      endpoint={RPC_ENDPOINT}
      config={{ commitment: "confirmed" }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
