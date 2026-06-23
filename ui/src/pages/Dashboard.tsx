import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";

import { color, font, radius, brandFor } from "../ui/tokens";
import {
  AnimBar,
  CoinBadge,
  MCard,
  MLabel,
  Skeleton,
  SkeletonCircle,
  Stagger,
  TickerNum,
  TickerUSD,
  btnGhost,
  btnPrimary,
  fmtUSD,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { KNOWN_MINTS, XUSD_DECIMALS } from "../config";
import { useUserData, rawToWhole } from "../hooks/useUserData";
import { type Collateral, priceToUsd } from "../collateral";
import type { Position } from "../positions";

export default function DashboardPage() {
  const { connected } = useWallet();
  return <Shell>{connected ? <Connected /> : <Disconnected />}</Shell>;
}

// ===========================================================
// Connected dashboard
// ===========================================================

function Connected() {
  const nav = useNavigate();
  const { positions, collaterals, balances, loading } = useUserData();

  // Closed/liquidated positions (close_date != 0) live in the History page.
  const openPositions = useMemo(() => positions.filter((p) => p.closeDate === 0n), [positions]);

  const collateralBy = useMemo(() => {
    const m = new Map<string, Collateral>();
    for (const c of collaterals) m.set(c.mint.toBase58(), c);
    return m;
  }, [collaterals]);

  const xusdBalance = balances.find(
    (b) => KNOWN_MINTS[b.mint]?.symbol === 'XUSD' || b.symbol === 'XUSD',
  );

  const totals = useMemo(() => {
    let collateralUsd = 0;
    let debtUsd = 0;
    let worstHealth = Infinity;
    for (const p of openPositions) {
      const c = collateralBy.get(p.collateralMint.toBase58());
      const decimals = KNOWN_MINTS[p.collateralMint.toBase58()]?.decimals ?? 8;
      const colWhole = rawToWhole(p.collateralAmount, decimals);
      const debtWhole = rawToWhole(p.loanAmount, XUSD_DECIMALS);
      const colUsd = c ? colWhole * priceToUsd(c.price) : 0;
      const liqLtv = c ? Number(c.liquidationLtv) / 10_000 : 0.95;
      collateralUsd += colUsd;
      debtUsd += debtWhole;
      if (debtWhole > 0 && colUsd > 0) {
        const liqValue = colUsd * liqLtv;
        const h = liqValue / debtWhole;
        if (h < worstHealth) worstHealth = h;
      }
    }
    const netWorth = collateralUsd - debtUsd + (xusdBalance ? rawToWhole(xusdBalance.rawBalance, XUSD_DECIMALS) : 0);
    return {
      netWorth,
      collateralUsd,
      debtUsd,
      health: worstHealth === Infinity ? null : worstHealth,
      positionCount: openPositions.length,
    };
  }, [openPositions, collateralBy, xusdBalance]);

  return (
    <>
      <Header onBorrow={() => nav('/app/borrow')} onEarn={() => nav('/app/earn')} />
      <KpiRow {...totals} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, marginTop: 20 }}>
        <PositionsPanel positions={openPositions} collateralBy={collateralBy} loading={loading} onOpen={() => nav('/app/borrow')} />
        <SidePanel collaterals={collaterals} loading={loading} onPick={(mint) => nav(`/app/borrow?asset=${mint}`)} />
      </div>
    </>
  );
}

function Header({ onBorrow, onEarn }: { onBorrow: () => void; onEarn: () => void }) {
  const { publicKey } = useWallet();
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);
  const name = publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : '';
  return (
    <div style={{ marginBottom: 24 }}>
      <MLabel>Overview</MLabel>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 30, fontWeight: 500, margin: '4px 0 0', letterSpacing: '-0.025em' }}>
          {greeting}, {name}.
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnGhost()} onClick={onEarn}>Earn XUSD</button>
          <button style={btnPrimary()} onClick={onBorrow}>Borrow →</button>
        </div>
      </div>
    </div>
  );
}

function KpiRow({
  netWorth,
  collateralUsd,
  debtUsd,
  health,
  positionCount,
}: {
  netWorth: number;
  collateralUsd: number;
  debtUsd: number;
  health: number | null;
  positionCount: number;
}) {
  const kpis: Array<{ label: string; node: React.ReactNode; sub: string; tint?: string }> = [
    {
      label: 'Net worth',
      node: <TickerUSD to={netWorth} />,
      sub: `${positionCount} position${positionCount === 1 ? '' : 's'}`,
    },
    {
      label: 'Collateral value',
      node: <TickerUSD to={collateralUsd} />,
      sub: 'across positions',
    },
    {
      label: 'Total borrowed',
      node: <TickerUSD to={debtUsd} />,
      sub: 'XUSD',
      tint: color.accent,
    },
    {
      label: 'Health factor',
      node: health === null ? <span>—</span> : <TickerNum to={health} suffix="×" decimals={2} />,
      sub: health === null ? 'no debt' : health < 1.5 ? 'at risk' : 'healthy',
      tint: health === null ? color.text : health < 1.5 ? color.amber : color.green,
    },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0,
        border: `1px solid ${color.border}`,
        borderRadius: radius.xl,
        background: color.surface,
        overflow: 'hidden',
      }}
    >
      {kpis.map((k, i) => (
        <div key={k.label} style={{ padding: '20px 22px', borderRight: i < kpis.length - 1 ? `1px solid ${color.border}` : 'none' }}>
          <MLabel>{k.label}</MLabel>
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              marginTop: 6,
              letterSpacing: '-0.02em',
              fontFamily: font.mono,
              color: k.tint ?? color.text,
            }}
          >
            {k.node}
          </div>
          <div style={{ fontSize: 12, color: color.textDim, marginTop: 4, fontFamily: font.mono }}>{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

function PositionsPanel({
  positions,
  collateralBy,
  loading,
  onOpen,
}: {
  positions: Position[];
  collateralBy: Map<string, Collateral>;
  loading: boolean;
  onOpen: () => void;
}) {
  const nav = useNavigate();
  return (
    <MCard padding={0}>
      <div
        style={{
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500 }}>Your positions</div>
        <div style={{ fontSize: 12, color: color.textDim, cursor: 'pointer' }} onClick={onOpen}>
          + Open new →
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 1fr 1.5fr 80px',
          gap: 16,
          padding: '10px 18px',
          fontSize: 11,
          color: color.textDim,
          fontFamily: font.mono,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <div>Position</div>
        <div style={{ textAlign: 'right' }}>Collateral</div>
        <div style={{ textAlign: 'right' }}>Debt</div>
        <div>LTV</div>
        <div style={{ textAlign: 'right' }}>Health</div>
      </div>

      {loading && positions.length === 0 &&
        Array.from({ length: 3 }).map((_, i) => <PositionRowSkeleton key={i} />)}
      {!loading && positions.length === 0 && (
        <div style={{ padding: '40px 18px', fontSize: 13, color: color.textDim, textAlign: 'center' }}>
          No positions yet.{' '}
          <span style={{ color: color.accent, cursor: 'pointer' }} onClick={onOpen}>
            Open one →
          </span>
        </div>
      )}

      <Stagger base={300} step={70}>
        {positions.map((p, i) => {
          const c = collateralBy.get(p.collateralMint.toBase58());
          const symbol = KNOWN_MINTS[p.collateralMint.toBase58()]?.symbol ?? 'COL';
          const decimals = KNOWN_MINTS[p.collateralMint.toBase58()]?.decimals ?? 8;
          const colWhole = rawToWhole(p.collateralAmount, decimals);
          const debtWhole = rawToWhole(p.loanAmount, XUSD_DECIMALS);
          const price = c ? priceToUsd(c.price) : 0;
          const colUsd = colWhole * price;
          const ltv = colUsd > 0 ? Math.min(100, (debtWhole / colUsd) * 100) : 0;
          const maxLtv = c ? Number(c.ltv) / 100 : 80;
          const liqLtv = c ? Number(c.liquidationLtv) / 100 : 95;
          const health = debtWhole > 0 && colUsd > 0 ? (colUsd * (liqLtv / 100)) / debtWhole : Infinity;
          const brand = brandFor(symbol);
          return (
            <div
              key={p.address.toBase58()}
              onClick={() => nav(`/app/positions/${p.address.toBase58()}`)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr 1.5fr 80px',
                gap: 16,
                padding: '14px 18px',
                alignItems: 'center',
                borderBottom: `1px solid ${color.border}`,
                cursor: 'pointer',
                transition: 'background 150ms',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = color.surfaceHi)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{symbol} position</div>
                  <div style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
                    #{i + 1}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontFamily: font.mono, fontSize: 13 }}>
                <div>{colWhole.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                <div style={{ fontSize: 11, color: color.textMute }}>{fmtUSD(colUsd)}</div>
              </div>
              <div style={{ textAlign: 'right', fontFamily: font.mono, fontSize: 13 }}>
                {fmtUSD(debtWhole)}
                <div style={{ fontSize: 11, color: color.textMute }}>XUSD</div>
              </div>
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: color.textDim,
                    fontFamily: font.mono,
                    marginBottom: 5,
                  }}
                >
                  <span>{ltv.toFixed(0)}%</span>
                  <span style={{ color: color.textMute }}>max {maxLtv.toFixed(0)}%</span>
                </div>
                <AnimBar
                  pct={(ltv / maxLtv) * 100}
                  fill={ltv > maxLtv * 0.85 ? color.amber : color.accent}
                  height={4}
                  delay={400 + i * 100}
                />
              </div>
              <div
                style={{
                  textAlign: 'right',
                  fontFamily: font.mono,
                  fontSize: 13,
                  color: health === Infinity ? color.text : health < 1.5 ? color.amber : color.green,
                }}
              >
                {health === Infinity ? '∞' : `${health.toFixed(2)}×`}
              </div>
            </div>
          );
        })}
      </Stagger>
    </MCard>
  );
}

function SidePanel({ collaterals, loading, onPick }: { collaterals: Collateral[]; loading: boolean; onPick: (mint: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <CollateralsCard collaterals={collaterals} loading={loading} onPick={onPick} />
      <ActivityCard />
    </div>
  );
}

export function CollateralsCard({
  collaterals,
  loading = false,
  onPick,
}: {
  collaterals: Collateral[];
  loading?: boolean;
  onPick?: (mint: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const allowed = collaterals.filter((c) => c.allowed);

  return (
    <MCard padding={0} style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: '16px 20px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <MLabel>Accepted collaterals</MLabel>
        <div style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
          {allowed.length} asset{allowed.length === 1 ? '' : 's'}
        </div>
      </div>

      <div
        style={{
          padding: '10px 20px',
          display: 'grid',
          gridTemplateColumns: '1.4fr 0.8fr 0.9fr 1fr',
          gap: 12,
          fontSize: 10.5,
          color: color.textMute,
          fontFamily: font.mono,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <div>Asset</div>
        <div style={{ textAlign: 'right' }}>Max LTV</div>
        <div style={{ textAlign: 'right' }}>Liq. thr.</div>
        <div style={{ textAlign: 'right' }}>Oracle</div>
      </div>

      {loading && allowed.length === 0 &&
        Array.from({ length: 2 }).map((_, i) => <CollateralRowSkeleton key={i} last={i === 1} />)}
      {!loading && allowed.length === 0 && (
        <div style={{ padding: '24px 20px', fontSize: 12.5, color: color.textDim, textAlign: 'center' }}>
          No collaterals registered.
        </div>
      )}

      {allowed.map((c, i) => {
        const symbol = KNOWN_MINTS[c.mint.toBase58()]?.symbol ?? c.mint.toBase58().slice(0, 4);
        const brand = brandFor(symbol);
        const maxLtv = Number(c.ltv) / 100;
        const liqThreshold = Number(c.liquidationLtv) / 100;
        const isHover = hover === i;
        return (
          <div
            key={c.mint.toBase58()}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPick?.(c.mint.toBase58())}
            style={{
              position: 'relative',
              padding: '14px 20px',
              borderBottom: i < allowed.length - 1 ? `1px solid ${color.border}` : 'none',
              background: isHover ? 'rgba(99, 102, 241, 0.06)' : 'transparent',
              transition: 'background 160ms ease',
              cursor: onPick ? 'pointer' : 'default',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 0.8fr 0.9fr 1fr',
                gap: 12,
                alignItems: 'center',
                opacity: isHover && onPick ? 0 : 1,
                transition: 'opacity 160ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{symbol}</div>
                  <div style={{ fontSize: 11, color: color.textMute }}>
                    {symbol === 'WETH' ? 'Wrapped Ether' : symbol === 'WBTC' ? 'Wrapped Bitcoin' : symbol}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontFamily: font.mono, fontSize: 13 }}>
                {maxLtv.toFixed(0)}
                <span style={{ color: color.textMute }}>%</span>
              </div>
              <div style={{ textAlign: 'right', fontFamily: font.mono, fontSize: 13, color: color.textDim }}>
                {liqThreshold.toFixed(0)}
                <span style={{ color: color.textMute }}>%</span>
              </div>
              <div style={{ textAlign: 'right', fontFamily: font.mono, fontSize: 13 }}>
                <span style={{ color: color.textMute }}>$</span>
                {priceToUsd(c.price).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>

            {onPick && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 20px',
                  gap: 12,
                  opacity: isHover ? 1 : 0,
                  transform: isHover ? 'translateX(0)' : 'translateX(-4px)',
                  transition: 'opacity 160ms ease, transform 160ms ease',
                  pointerEvents: isHover ? 'auto' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} />
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>Borrow against {symbol}</div>
                    <div style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
                      up to {maxLtv.toFixed(0)}% LTV
                    </div>
                  </div>
                </div>
                <button style={btnPrimary({ padding: '8px 14px', fontSize: 12.5 })}>Open position →</button>
              </div>
            )}
          </div>
        );
      })}
    </MCard>
  );
}

function PositionRowSkeleton() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 1fr 1fr 1.5fr 80px',
        gap: 16,
        padding: '14px 18px',
        alignItems: 'center',
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SkeletonCircle size={30} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Skeleton width={110} height={10} />
          <Skeleton width={56} height={8} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <Skeleton width={70} height={10} />
        <Skeleton width={50} height={8} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <Skeleton width={70} height={10} />
        <Skeleton width={40} height={8} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Skeleton width={26} height={8} />
          <Skeleton width={48} height={8} />
        </div>
        <Skeleton width="100%" height={4} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton width={42} height={10} />
      </div>
    </div>
  );
}

function CollateralRowSkeleton({ last = false }: { last?: boolean }) {
  return (
    <div
      style={{
        padding: '14px 20px',
        borderBottom: last ? 'none' : `1px solid ${color.border}`,
        display: 'grid',
        gridTemplateColumns: '1.4fr 0.8fr 0.9fr 1fr',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SkeletonCircle size={30} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Skeleton width={50} height={10} />
          <Skeleton width={86} height={8} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton width={36} height={10} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton width={36} height={10} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton width={64} height={10} />
      </div>
    </div>
  );
}

function ActivityCard() {
  return (
    <MCard padding={0}>
      <div
        style={{
          padding: '16px 20px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <MLabel>Recent activity</MLabel>
        <span style={{ fontSize: 11, color: color.textMute, cursor: 'pointer' }}>All →</span>
      </div>
      <div style={{ padding: '20px', fontSize: 12.5, color: color.textDim, textAlign: 'center' }}>
        Activity feed coming soon.
      </div>
    </MCard>
  );
}

// ===========================================================
// Disconnected dashboard
// ===========================================================

function Disconnected() {
  const { collaterals, loading } = useUserData();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 }}>
      <ConnectPanel />
      <CollateralsCard collaterals={collaterals} loading={loading} />
    </div>
  );
}

function ConnectPanel() {
  return (
    <MCard
      padding={0}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 48px',
        minHeight: 560,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 320,
          height: 320,
          borderRadius: 99,
          background: color.accentDim,
          filter: 'blur(80px)',
          opacity: 0.55,
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 460 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: color.accentDim,
            color: color.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            margin: '0 auto 22px',
            border: `1px solid ${color.borderHi}`,
          }}
        >
          ◐
        </div>
        <MLabel style={{ marginBottom: 10 }}>Wallet not connected</MLabel>
        <h2 style={{ fontSize: 32, fontWeight: 500, margin: 0, letterSpacing: '-0.025em' }}>
          Connect to continue
        </h2>
        <div style={{ fontSize: 14, color: color.textDim, marginTop: 12, lineHeight: 1.55 }}>
          Connect a wallet to open positions, mint XUSD against your collateral, and earn yield from the savings vault.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 26, justifyContent: 'center' }}>
          <ConnectButton style={btnPrimary({ padding: '11px 20px', fontSize: 13.5 })}>
            Connect wallet →
          </ConnectButton>
          <button style={btnGhost({ padding: '11px 20px', fontSize: 13.5 })}>Learn more</button>
        </div>

        <div
          style={{
            marginTop: 44,
            paddingTop: 22,
            borderTop: `1px solid ${color.border}`,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}
        >
          {[
            ['—', 'TVL'],
            ['—', 'Total borrowed'],
            ['—', 'Savings APY'],
          ].map(([v, k]) => (
            <div key={k}>
              <div style={{ fontFamily: font.mono, fontSize: 22, color: color.text }}>{v}</div>
              <MLabel style={{ marginTop: 4 }}>{k}</MLabel>
            </div>
          ))}
        </div>
      </div>
    </MCard>
  );
}
