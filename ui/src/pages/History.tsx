import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { color, font, brandFor } from "../ui/tokens";
import {
  CoinBadge,
  MCard,
  MLabel,
  PageFade,
  Skeleton,
  SkeletonCircle,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { KNOWN_MINTS } from "../config";
import { useUserData } from "../hooks/useUserData";

export default function HistoryPage() {
  const { connected } = useWallet();
  return <Shell>{connected ? <History /> : <Locked />}</Shell>;
}

function Locked() {
  return (
    <PageFade style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <MCard padding={32} style={{ textAlign: 'center', maxWidth: 460 }}>
        <MLabel>History</MLabel>
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: '6px 0 12px', letterSpacing: '-0.02em' }}>
          Connect to view history
        </h2>
        <div style={{ fontSize: 14, color: color.textDim, marginBottom: 22, lineHeight: 1.55 }}>
          Closed and liquidated positions appear here once you've connected your wallet.
        </div>
        <ConnectButton />
      </MCard>
    </PageFade>
  );
}

function formatDate(unixSeconds: bigint): string {
  if (unixSeconds === 0n) return '—';
  const d = new Date(Number(unixSeconds) * 1000);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function History() {
  const { positions, loading } = useUserData();

  // Closed/liquidated positions carry a non-zero close_date.
  const closed = useMemo(
    () =>
      positions
        .filter((p) => p.closeDate !== 0n)
        .sort((a, b) => Number(b.closeDate - a.closeDate)),
    [positions],
  );

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <MLabel>History</MLabel>
        <h1 style={{ fontSize: 30, fontWeight: 500, margin: '4px 0 0', letterSpacing: '-0.025em' }}>
          Closed positions
        </h1>
      </div>

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
          <div style={{ fontSize: 14, fontWeight: 500 }}>Position history</div>
          <div style={{ fontSize: 12, color: color.textMute, fontFamily: font.mono }}>
            {closed.length} closed
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr 1fr',
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
          <div>Closed</div>
          <div style={{ textAlign: 'right' }}>Status</div>
        </div>

        {loading && closed.length === 0 &&
          Array.from({ length: 3 }).map((_, i) => <RowSkeleton key={i} />)}

        {!loading && closed.length === 0 && (
          <div style={{ padding: '40px 18px', fontSize: 13, color: color.textDim, textAlign: 'center' }}>
            No closed positions yet.
          </div>
        )}

        {closed.map((p) => {
          const symbol = KNOWN_MINTS[p.collateralMint.toBase58()]?.symbol ?? 'COL';
          const brand = brandFor(symbol);
          return (
            <div
              key={p.address.toBase58()}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 1fr 1fr',
                gap: 16,
                padding: '14px 18px',
                alignItems: 'center',
                borderBottom: `1px solid ${color.border}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{symbol} position</div>
                  <div style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
                    #{Number(p.index)}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: color.textDim, fontFamily: font.mono }}>
                {formatDate(p.closeDate)}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    fontSize: 10.5,
                    padding: '3px 9px',
                    borderRadius: 99,
                    fontFamily: font.mono,
                    letterSpacing: '0.04em',
                    background: 'rgba(150, 150, 150, 0.12)',
                    color: color.textMute,
                  }}
                >
                  ● Closed
                </span>
              </div>
            </div>
          );
        })}
      </MCard>
    </>
  );
}

function RowSkeleton() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr 1fr',
        gap: 16,
        padding: '14px 18px',
        alignItems: 'center',
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SkeletonCircle size={30} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Skeleton width={110} height={10} />
          <Skeleton width={40} height={8} />
        </div>
      </div>
      <Skeleton width={120} height={10} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton width={60} height={16} radius={99} />
      </div>
    </div>
  );
}
