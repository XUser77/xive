import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";

import { RPC_ENDPOINT } from "./config";
import { ConnectModalProvider } from "./ui/ConnectButton";

export function WalletProviders({ children }: { children: ReactNode }) {
  // Phantom and other wallet-standard wallets auto-register; we add fallbacks
  // for Solflare and Backpack which are still legacy-adapter based.
  const wallets = useMemo(
    () => [
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
      new BackpackWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <ConnectModalProvider>{children}</ConnectModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
