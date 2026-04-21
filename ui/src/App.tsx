import { WalletProviders } from "./WalletProviders";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { CollateralList } from "./CollateralList";
import { RPC_ENDPOINT } from "./config";

export default function App() {
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
        <CollateralList />
      </div>
    </WalletProviders>
  );
}
