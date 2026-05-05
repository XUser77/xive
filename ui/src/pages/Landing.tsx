import { useNavigate } from "react-router-dom";
import { color, font, radius } from "../ui/tokens";
import { BetaPill, LiveDot, MLabel, PageFade, btnGhost, btnPrimary } from "../ui/primitives";
import { ConnectButton } from "../ui/ConnectButton";

export default function Landing() {
  const nav = useNavigate();
  return (
    <div
      style={{
        background: color.bg,
        color: color.text,
        fontFamily: font.display,
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Nav onLaunch={() => nav('/app')} />
      <PageFade style={{ flex: 1 }}>
        <Hero onLaunch={() => nav('/app')} />
        <What />
        <How />
        <Footer />
      </PageFade>
    </div>
  );
}

function Nav({ onLaunch }: { onLaunch: () => void }) {
  const links = ['Docs', 'Markets', 'Stats', 'Blog'];
  return (
    <div
      style={{
        height: 64,
        borderBottom: `1px solid ${color.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px',
        position: 'sticky',
        top: 0,
        background: 'rgba(11, 13, 16, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>XIVE</div>
        <BetaPill />
      </div>
      <div style={{ display: 'flex', gap: 28, fontSize: 13.5, color: color.textDim }}>
        {links.map((l) => (
          <span key={l} style={{ cursor: 'pointer' }}>
            {l}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <ConnectButton style={btnGhost({ padding: '9px 16px', fontSize: 13 })}>Connect wallet</ConnectButton>
        <button style={btnPrimary({ padding: '9px 18px', fontSize: 13 })} onClick={onLaunch}>
          Launch app →
        </button>
      </div>
    </div>
  );
}

function Hero({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', padding: '120px 48px 100px' }}>
      <div
        style={{
          position: 'absolute',
          top: -200,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 900,
          height: 600,
          borderRadius: '50%',
          background: color.accentDim,
          filter: 'blur(140px)',
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.4,
          backgroundImage: `linear-gradient(${color.border} 1px, transparent 1px), linear-gradient(90deg, ${color.border} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 50% 30%, black 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, black 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: radius.pill,
            border: `1px solid ${color.border}`,
            fontSize: 12,
            color: color.textDim,
            fontFamily: font.mono,
            letterSpacing: '0.04em',
            marginBottom: 32,
          }}
        >
          <LiveDot />
          Live on devnet · v0.4.2
        </div>

        <h1
          style={{
            fontSize: 84,
            fontWeight: 500,
            lineHeight: 1.02,
            letterSpacing: '-0.035em',
            margin: 0,
          }}
        >
          A stablecoin you
          <br />
          <span style={{ color: color.accent }}>mint yourself.</span>
        </h1>

        <div
          style={{
            fontSize: 18,
            color: color.textDim,
            marginTop: 26,
            lineHeight: 1.5,
            maxWidth: 580,
            margin: '26px auto 0',
          }}
        >
          Deposit ETH or wBTC, mint XUSD against it at up to 80% LTV. Keep your upside, spend dollars, repay anytime — no fixed term, no middlemen.
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 36 }}>
          <button style={btnPrimary({ padding: '13px 24px', fontSize: 14 })} onClick={onLaunch}>
            Launch app →
          </button>
          <button style={btnGhost({ padding: '13px 24px', fontSize: 14 })}>Read the docs</button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 0,
            background: color.surface,
            border: `1px solid ${color.border}`,
            borderRadius: radius.xxl,
            overflow: 'hidden',
            maxWidth: 880,
            margin: '80px auto 0',
          }}
        >
          {[
            ['—', 'Total value locked'],
            ['—', 'XUSD outstanding'],
            ['—', 'Savings APY'],
            ['—', 'Active positions'],
          ].map(([v, k], i, arr) => (
            <div
              key={k}
              style={{
                padding: '20px 22px',
                textAlign: 'left',
                borderRight: i < arr.length - 1 ? `1px solid ${color.border}` : 'none',
              }}
            >
              <div
                style={{
                  fontSize: 26,
                  fontFamily: font.mono,
                  fontWeight: 400,
                  letterSpacing: '-0.02em',
                }}
              >
                {v}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: color.textDim,
                  fontFamily: font.mono,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginTop: 4,
                }}
              >
                {k}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function What() {
  const facts = [
    {
      k: '01',
      t: 'Overcollateralized',
      d: 'Every XUSD in circulation is backed by more than $1 of crypto collateral, so the peg holds even if markets move.',
    },
    {
      k: '02',
      t: 'Non-custodial',
      d: "Your collateral lives in a smart contract — not on a balance sheet. You control the keys; you control the position.",
    },
    {
      k: '03',
      t: 'No fixed term',
      d: 'Mint XUSD when you need dollars; repay whenever. There is no maturity date, no rolling, no liquidation deadline.',
    },
    {
      k: '04',
      t: 'Transparent on-chain',
      d: "Total supply, every position's health, and the savings vault's reserves are public and verifiable in real time.",
    },
  ];
  return (
    <div style={{ padding: '100px 48px', borderTop: `1px solid ${color.border}` }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 80, alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 100 }}>
            <MLabel style={{ marginBottom: 16, letterSpacing: '0.08em' }}>What is XUSD</MLabel>
            <h2
              style={{
                fontSize: 44,
                fontWeight: 500,
                margin: 0,
                letterSpacing: '-0.025em',
                lineHeight: 1.1,
              }}
            >
              A dollar, fully backed by your collateral.
            </h2>
            <div style={{ fontSize: 15, color: color.textDim, marginTop: 18, lineHeight: 1.6 }}>
              XUSD is a decentralized stablecoin you mint by locking crypto. No bank, no issuer — just code and overcollateralized math.
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {facts.map((f, i, arr) => (
              <div
                key={f.k}
                style={{
                  padding: '24px 0',
                  borderTop: `1px solid ${color.border}`,
                  borderBottom: i === arr.length - 1 ? `1px solid ${color.border}` : 'none',
                  display: 'grid',
                  gridTemplateColumns: '60px 1fr',
                  gap: 24,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: color.accent,
                    fontFamily: font.mono,
                    letterSpacing: '0.06em',
                  }}
                >
                  {f.k}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>{f.t}</div>
                  <div style={{ fontSize: 14, color: color.textDim, marginTop: 6, lineHeight: 1.55 }}>{f.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function How() {
  const steps = [
    {
      n: '01',
      t: 'Deposit collateral',
      d: 'Lock ETH or wBTC in a position. Your asset stays yours — you keep the upside if it appreciates.',
      v: 'deposit' as const,
    },
    {
      n: '02',
      t: 'Mint XUSD',
      d: "Borrow up to 80% of your collateral's value as XUSD. Spend it, swap it, or deposit it for yield.",
      v: 'mint' as const,
    },
    {
      n: '03',
      t: 'Repay anytime',
      d: 'Pay back XUSD whenever you want and unlock your collateral. No fixed term, no penalties.',
      v: 'repay' as const,
    },
  ];
  return (
    <div style={{ padding: '100px 48px', borderTop: `1px solid ${color.border}` }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <MLabel style={{ marginBottom: 14, letterSpacing: '0.08em' }}>How it works</MLabel>
          <h2 style={{ fontSize: 44, fontWeight: 500, margin: 0, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            Three steps, on-chain.
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {steps.map((step) => (
            <div
              key={step.n}
              style={{
                background: color.surface,
                border: `1px solid ${color.border}`,
                borderRadius: radius.xxl,
                padding: 28,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 320,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: color.accent,
                  fontFamily: font.mono,
                  letterSpacing: '0.08em',
                  marginBottom: 18,
                }}
              >
                STEP {step.n}
              </div>
              <div
                style={{
                  height: 120,
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <HowVisual kind={step.v} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em' }}>{step.t}</div>
              <div style={{ fontSize: 14, color: color.textDim, marginTop: 8, lineHeight: 1.55 }}>{step.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HowVisual({ kind }: { kind: 'deposit' | 'mint' | 'repay' }) {
  if (kind === 'deposit') {
    return (
      <div style={{ position: 'relative', width: 180, height: 100 }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 56,
            height: 56,
            borderRadius: 14,
            background: color.accentDim,
            color: color.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            border: `1px solid ${color.borderHi}`,
          }}
        >
          Ξ
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 120,
            height: 4,
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent, ${color.accent}, transparent)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 18,
            color: color.accent,
            fontFamily: 'monospace',
          }}
        >
          ↓
        </div>
      </div>
    );
  }
  if (kind === 'mint') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 12,
            background: color.surfaceHi,
            border: `1px solid ${color.borderHi}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            color: color.text,
          }}
        >
          Ξ
        </div>
        <div style={{ width: 50, height: 1, background: color.borderHi, position: 'relative' }}>
          <span style={{ position: 'absolute', top: -7, right: -2, color: color.accent, fontSize: 14 }}>→</span>
        </div>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 99,
            background: color.accent,
            color: color.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}
        >
          $
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', width: 180, height: 100 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
        }}
      >
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 99,
            background: color.accent,
            color: color.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          $
        </div>
        <div
          style={{
            fontSize: 11,
            color: color.textDim,
            fontFamily: 'monospace',
            letterSpacing: '0.05em',
          }}
        >
          REPAY
        </div>
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 12,
            background: color.surfaceHi,
            border: `1px solid ${color.borderHi}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            color: color.text,
          }}
        >
          Ξ
        </div>
      </div>
      <div style={{ position: 'absolute', top: 24, left: 50, right: 50, height: 1, background: color.borderHi }} />
    </div>
  );
}

function Footer() {
  const cols = [
    { h: 'Product', links: ['Borrow', 'Earn', 'Markets', 'Launch app'] },
    { h: 'Resources', links: ['Docs', 'Whitepaper', 'Audits', 'Brand kit'] },
    { h: 'Community', links: ['Twitter', 'Discord', 'Mirror', 'Github'] },
    { h: 'Legal', links: ['Terms', 'Privacy', 'Risk disclosure'] },
  ];
  return (
    <div style={{ borderTop: `1px solid ${color.border}`, padding: '64px 48px 36px', background: color.bg }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr repeat(4, 1fr)',
            gap: 32,
            paddingBottom: 48,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>XIVE</div>
              <BetaPill />
            </div>
            <div
              style={{
                fontSize: 13,
                color: color.textDim,
                marginTop: 12,
                lineHeight: 1.55,
                maxWidth: 240,
              }}
            >
              A stablecoin protocol for people who own crypto and want dollars.
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.h}>
              <MLabel style={{ marginBottom: 14 }}>{c.h}</MLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {c.links.map((l) => (
                  <span key={l} style={{ fontSize: 13.5, color: color.text, cursor: 'pointer' }}>
                    {l}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            paddingTop: 24,
            borderTop: `1px solid ${color.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            color: color.textMute,
            fontFamily: font.mono,
          }}
        >
          <span>© 2026 XIVE Labs · open-source under MIT</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LiveDot />
            All systems normal
          </span>
        </div>
      </div>
    </div>
  );
}
