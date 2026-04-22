import { useState } from "react";

import { WalletProviders } from "./WalletProviders";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MainTab } from "./MainTab";
import { Cheats } from "./Cheats";
import { VaultTab } from "./VaultTab";
import { RPC_ENDPOINT } from "./config";

type Tab = "main" | "vault" | "cheats";

export default function App() {
  const [tab, setTab] = useState<Tab>("main");

  return (
    <WalletProviders>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <h1>Xive</h1>
            <span className="cluster">{RPC_ENDPOINT}</span>
          </div>
          <div className="actions">
            <WalletMultiButton />
          </div>
        </header>

        <nav className="tabs">
          <button
            className={`tab ${tab === "main" ? "active" : ""}`}
            onClick={() => setTab("main")}
          >
            Main
          </button>
          <button
            className={`tab ${tab === "vault" ? "active" : ""}`}
            onClick={() => setTab("vault")}
          >
            Vault
          </button>
          <button
            className={`tab ${tab === "cheats" ? "active" : ""}`}
            onClick={() => setTab("cheats")}
          >
            Cheats
          </button>
        </nav>

        {tab === "main" && <MainTab />}
        {tab === "vault" && <VaultTab />}
        {tab === "cheats" && <Cheats />}
      </div>
    </WalletProviders>
  );
}
