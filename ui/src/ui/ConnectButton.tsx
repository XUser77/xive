import { CSSProperties, ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { useWallet, Wallet } from "@solana/wallet-adapter-react";

import { color, font, radius } from "./tokens";
import { MCard, MLabel, PageFade, btnPrimary } from "./primitives";

// ---------- Modal context — pop the picker from anywhere ----------

const ConnectModalCtx = createContext<{ open: () => void; close: () => void } | null>(null);

export function ConnectModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { connected } = useWallet();

  // Auto-close when a wallet connects.
  useEffect(() => {
    if (connected) setOpen(false);
  }, [connected]);

  const api = {
    open: () => setOpen(true),
    close: () => setOpen(false),
  };

  return (
    <ConnectModalCtx.Provider value={api}>
      {children}
      {open && <ConnectModal onClose={api.close} />}
    </ConnectModalCtx.Provider>
  );
}

export function useConnectModal() {
  const ctx = useContext(ConnectModalCtx);
  if (!ctx) throw new Error("ConnectModalProvider missing");
  return ctx;
}

// ---------- Trigger button ----------

export function ConnectButton({
  children,
  style,
  className,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  const { open } = useConnectModal();
  return (
    <button
      className={className}
      style={style ?? btnPrimary({ padding: '8px 14px', fontSize: 12.5 })}
      onClick={open}
    >
      {children ?? 'Connect wallet →'}
    </button>
  );
}

// ---------- Modal: custom Solana wallet picker ----------

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { wallets, select, connect } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = useCallback(
    async (w: Wallet) => {
      setErr(null);
      setBusy(w.adapter.name);
      try {
        select(w.adapter.name);
        // Anchor the connect call after select propagates.
        await new Promise((r) => setTimeout(r, 0));
        await connect();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [connect, select],
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 6, 9, 0.7)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 100,
        zIndex: 100,
      }}
    >
      <PageFade style={{ width: 420 }}>
        <MCard
          padding={24}
          style={{
            border: `1px solid ${color.borderHi}`,
            boxShadow: '0 30px 60px -20px rgba(0,0,0,0.6)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <MLabel>Connect to continue</MLabel>
            <div
              onClick={onClose}
              style={{
                width: 24,
                height: 24,
                borderRadius: radius.md,
                border: `1px solid ${color.border}`,
                color: color.textDim,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              ×
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {wallets.length === 0 && (
              <div style={{ fontSize: 13, color: color.textDim }}>
                No Solana wallet detected. Install Phantom, Backpack, or Solflare.
              </div>
            )}
            {wallets.map((w) => (
              <div
                key={w.adapter.name}
                onClick={() => void pick(w)}
                style={{
                  padding: '12px 14px',
                  borderRadius: radius.lg,
                  border: `1px solid ${color.border}`,
                  background: color.bg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: busy ? 'wait' : 'pointer',
                  transition: 'all 150ms',
                  opacity: busy && busy !== w.adapter.name ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (busy) return;
                  e.currentTarget.style.background = color.surfaceHi;
                  e.currentTarget.style.borderColor = color.borderHi;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = color.bg;
                  e.currentTarget.style.borderColor = color.border;
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: radius.lg,
                    background: color.surfaceHi,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {w.adapter.icon ? (
                    <img src={w.adapter.icon} alt="" width={20} height={20} />
                  ) : (
                    <span style={{ fontSize: 16 }}>◐</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{w.adapter.name}</div>
                  <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>
                    {busy === w.adapter.name
                      ? 'Connecting…'
                      : w.readyState === 'Installed'
                      ? 'Detected'
                      : 'Not installed'}
                  </div>
                </div>
                <span style={{ color: color.textMute, fontSize: 16 }}>→</span>
              </div>
            ))}
          </div>

          {err && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: radius.lg,
                background: 'rgba(236, 111, 111, 0.08)',
                border: `1px solid rgba(236, 111, 111, 0.25)`,
                color: color.red,
                fontSize: 12.5,
              }}
            >
              {err}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: color.textMute, marginTop: 14, lineHeight: 1.5 }}>
            By connecting you agree to the{' '}
            <span style={{ color: color.textDim, textDecoration: 'underline', cursor: 'pointer' }}>terms</span>.
            Xive is non-custodial.
          </div>
        </MCard>
      </PageFade>
    </div>
  );
}
