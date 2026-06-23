import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";

import { WalletProviders } from "./WalletProviders";
import { TxProvider } from "./hooks/useTxSender";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Borrow from "./pages/Borrow";
import Earn from "./pages/Earn";
import Swap from "./pages/Swap";
import History from "./pages/History";
import Manage from "./pages/Manage";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <WalletProviders>
      <TxProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<Dashboard />} />
            <Route path="/app/borrow" element={<Borrow />} />
            <Route path="/app/earn" element={<Earn />} />
            <Route path="/app/swap" element={<Swap />} />
            <Route path="/app/history" element={<History />} />
            <Route path="/app/positions/:id" element={<Manage />} />
            <Route path="/app/admin" element={<Admin />} />
            <Route path="/app/markets" element={<Navigate to="/app/swap" replace />} />
            <Route path="/app/activity" element={<Navigate to="/app" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </TxProvider>
    </WalletProviders>
  );
}
