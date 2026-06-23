import { ReactNode, useState } from "react";
import { useLocation, NavLink } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";

import { color, font, radius } from "./tokens";
import { BetaPill, LiveDot, PageFade, btnPrimary, shortenAddr } from "./primitives";
import { ConnectButton, useConnectModal } from "./ConnectButton";
import { RPC_ENDPOINT } from "../config";

const RPC_DISPLAY = RPC_ENDPOINT.replace(/^https?:\/\//, "");

export type NavKey = 'overview' | 'borrow' | 'earn' | 'swap' | 'history' | 'activity' | 'admin';

const NAV_ITEMS: { key: NavKey; label: string; icon: string; to: string; dimmedWhenDisconnected?: boolean }[] = [
  { key: 'overview', label: 'Overview', icon: '◐', to: '/app' },
  { key: 'borrow',   label: 'Borrow',   icon: '↓', to: '/app/borrow', dimmedWhenDisconnected: true },
  { key: 'earn',     label: 'Earn',     icon: '↑', to: '/app/earn',   dimmedWhenDisconnected: true },
  { key: 'swap',     label: 'Swap',     icon: '⇄', to: '/app/swap',   dimmedWhenDisconnected: true },
  { key: 'history',  label: 'History',  icon: '⌗', to: '/app/history', dimmedWhenDisconnected: true },
  { key: 'activity', label: 'Activity', icon: '≡', to: '/app/activity', dimmedWhenDisconnected: true },
  { key: 'admin',    label: 'Admin',    icon: '⚙',  to: '/app/admin' },
];

function Sidebar({ connected }: { connected: boolean }) {
  const loc = useLocation();
  return (
    <div
      style={{
        width: 220,
        background: color.bg,
        borderRight: `1px solid ${color.border}`,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '4px 12px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <NavLink to="/" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
          XIVE
        </NavLink>
        <BetaPill />
      </div>
      {NAV_ITEMS.map((it) => {
        const active = loc.pathname === it.to || (it.to !== '/app' && loc.pathname.startsWith(it.to));
        const dimmed = !connected && it.dimmedWhenDisconnected;
        return (
          <NavLink
            key={it.key}
            to={it.to}
            style={{
              padding: '8px 12px',
              borderRadius: radius.md,
              fontSize: 13.5,
              color: active ? color.text : color.textDim,
              background: active ? color.surface : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: dimmed ? 'not-allowed' : 'pointer',
              opacity: dimmed ? 0.5 : 1,
              transition: 'all 150ms',
              textDecoration: 'none',
            }}
            onClick={(e) => {
              if (dimmed) e.preventDefault();
            }}
          >
            <span style={{ fontSize: 13, opacity: 0.7, width: 14, textAlign: 'center' }}>{it.icon}</span>
            <span>{it.label}</span>
          </NavLink>
        );
      })}
      <div style={{ flex: 1 }} />
      {connected ? (
        <div
          style={{
            padding: 12,
            borderRadius: radius.lg,
            background: color.surface,
            border: `1px solid ${color.border}`,
            fontSize: 12,
          }}
        >
          <div style={{ color: color.textDim, marginBottom: 4 }}>Health</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <LiveDot />
            <span style={{ fontSize: 12.5 }}>All systems normal</span>
          </div>
          <div style={{ color: color.textMute, fontSize: 11, fontFamily: font.mono }}>
            v0.4.2 · uptime 99.98%
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: 12,
            borderRadius: radius.lg,
            background: color.surface,
            border: `1px solid ${color.border}`,
            fontSize: 12,
          }}
        >
          <div
            style={{
              color: color.textDim,
              marginBottom: 6,
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Protocol
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LiveDot />
            <span style={{ fontSize: 12.5 }}>Live · Devnet</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Topbar({ connected }: { connected: boolean }) {
  const { publicKey, disconnect } = useWallet();
  const [menu, setMenu] = useState(false);

  return (
    <div
      style={{
        height: 56,
        borderBottom: `1px solid ${color.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: color.textDim }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LiveDot />
          Live · Devnet
          <span style={{ color: color.textMute, fontFamily: font.mono }}>({RPC_DISPLAY})</span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
        {connected && publicKey ? (
          <>
            <button
              onClick={() => setMenu((v) => !v)}
              style={{
                padding: '6px 10px',
                borderRadius: radius.md,
                border: `1px solid ${color.border}`,
                fontSize: 12,
                color: color.textDim,
                fontFamily: font.mono,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <LiveDot size={6} />
              {shortenAddr(publicKey.toBase58())}
            </button>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: radius.pill,
                background: `linear-gradient(135deg, ${color.accent}, #c084fc)`,
              }}
            />
            {menu && (
              <div
                style={{
                  position: 'absolute',
                  top: 44,
                  right: 0,
                  width: 200,
                  background: color.surface,
                  border: `1px solid ${color.borderHi}`,
                  borderRadius: radius.lg,
                  padding: 6,
                  zIndex: 10,
                  boxShadow: '0 12px 28px -12px rgba(0,0,0,0.7)',
                }}
              >
                <div
                  style={{
                    padding: '10px 12px',
                    fontSize: 11,
                    fontFamily: font.mono,
                    color: color.textMute,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Wallet
                </div>
                <div
                  style={{ padding: '6px 12px 10px 12px', fontSize: 12, fontFamily: font.mono, wordBreak: 'break-all', color: color.textDim }}
                >
                  {publicKey.toBase58()}
                </div>
                <button
                  onClick={() => {
                    setMenu(false);
                    void disconnect();
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 13,
                    color: color.text,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = color.surfaceHi)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  Disconnect
                </button>
              </div>
            )}
          </>
        ) : (
          <ConnectButton style={btnPrimary({ padding: '8px 14px', fontSize: 12.5 })}>
            Connect wallet →
          </ConnectButton>
        )}
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { connected } = useWallet();
  return (
    <div
      style={{
        background: color.bg,
        color: color.text,
        fontFamily: font.display,
        minHeight: '100%',
        display: 'flex',
      }}
    >
      <Sidebar connected={connected} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar connected={connected} />
        <PageFade style={{ flex: 1, padding: '28px 32px', overflow: 'auto' }}>{children}</PageFade>
      </div>
    </div>
  );
}

// re-export so pages can pop the connect modal too
export { useConnectModal };
