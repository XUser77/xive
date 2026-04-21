import { useState } from "react";

import { WalletProviders } from "./WalletProviders";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { CollateralList } from "./CollateralList";
import { Cheats } from "./Cheats";
import { RPC_ENDPOINT } from "./config";

type Tab = "main" | "cheats";

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
            className={`tab ${tab === "cheats" ? "active" : ""}`}
            onClick={() => setTab("cheats")}
          >
            Cheats
          </button>
        </nav>

        {tab === "main" ? <CollateralList /> : <Cheats />}
      </div>
    </WalletProviders>
  );
}
