import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { color, font, radius, brandFor } from "../ui/tokens";
import {
  AnimBar,
  CoinBadge,
  MCard,
  MLabel,
  MonoInput,
  PageFade,
  Skeleton,
  SkeletonCircle,
  TickerNum,
  btnAccent,
  btnGhost,
  fmtUSD,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { KNOWN_MINTS, XUSD_DECIMALS } from "../config";
import { useUserData, rawToWhole, wholeToRaw, balanceOf } from "../hooks/useUserData";
import { useTxSender } from "../hooks/useTxSender";
import { createUserStateIx, openPositionIx } from "../xiveInstructions";
import { priceToUsd } from "../collateral";

const COMMISSION_BPS = 50n; // mirrors xive's DEFAULT_COMMISSION_BPS

export default function BorrowPage() {
  const { connected } = useWallet();
  return <Shell>{connected ? <BorrowFlow /> : <Locked />}</Shell>;
}

function Locked() {
  return (
    <PageFade style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <MCard padding={32} style={{ textAlign: 'center', maxWidth: 460 }}>
        <MLabel>Borrow</MLabel>
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: '6px 0 12px', letterSpacing: '-0.02em' }}>
          Connect to open a position
        </h2>
        <div style={{ fontSize: 14, color: color.textDim, marginBottom: 22, lineHeight: 1.55 }}>
          Lock collateral and mint XUSD against it. You'll need a connected wallet to continue.
        </div>
        <ConnectButton />
      </MCard>
    </PageFade>
  );
}

function BorrowFlow() {
  const { publicKey } = useWallet();
  const { collaterals, balances, userCounter, refresh, loading } = useUserData();
  const { send } = useTxSender();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const allowed = useMemo(() => collaterals.filter((c) => c.allowed), [collaterals]);

  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  useEffect(() => {
    if (selectedMint) return;
    const fromQuery = params.get('asset');
    if (fromQuery && allowed.some((c) => c.mint.toBase58() === fromQuery)) {
      setSelectedMint(fromQuery);
      return;
    }
    if (allowed[0]) setSelectedMint(allowed[0].mint.toBase58());
  }, [allowed, params, selectedMint]);

  const selected = allowed.find((c) => c.mint.toBase58() === selectedMint);
  const symbol = selected ? KNOWN_MINTS[selected.mint.toBase58()]?.symbol ?? 'COL' : '';
  const decimals = selected ? KNOWN_MINTS[selected.mint.toBase58()]?.decimals ?? 8 : 8;
  const balance = selected ? balanceOf(balances, selected.mint.toBase58()) : undefined;
  const balanceWhole = balance ? rawToWhole(balance.rawBalance, balance.decimals) : 0;
  const price = selected ? priceToUsd(selected.price) : 0;
  const maxLtvPct = selected ? Number(selected.ltv) / 100 : 0;
  const liqLtvPct = selected ? Number(selected.liquidationLtv) / 100 : 0;

  const [colInput, setColInput] = useState('');
  const [borrowInput, setBorrowInput] = useState('');

  const colWhole = parseFloat(colInput) || 0;
  const borrowWhole = parseFloat(borrowInput) || 0;
  const colUsd = colWhole * price;
  const fee = (borrowWhole * Number(COMMISSION_BPS)) / 10_000;
  const totalDebt = borrowWhole + fee;
  const maxBorrow = (colUsd * maxLtvPct) / 100;
  const ltvPct = colUsd > 0 ? (totalDebt / colUsd) * 100 : 0;
  const liqPrice = colWhole > 0 && totalDebt > 0 ? totalDebt / (colWhole * (liqLtvPct / 100)) : 0;
  const liqValue = colUsd * (liqLtvPct / 100);
  const health = totalDebt > 0 ? liqValue / totalDebt : Infinity;

  const validColAmount = colWhole > 0 && colWhole <= balanceWhole + 1e-9;
  const validBorrowAmount = borrowWhole > 0 && totalDebt <= maxBorrow + 1e-6;
  const valid = !!selected && validColAmount && validBorrowAmount;

  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!valid || !selected || !publicKey) return;
    setBusy(true);
    try {
      const ixs = [];
      // userCounter PDA might not exist yet for fresh wallets — call createUserState first.
      if (userCounter === null) ixs.push(createUserStateIx(publicKey));
      const counter = userCounter ?? 0n;
      const colRaw = wholeToRaw(colWhole, decimals);
      const loanRaw = wholeToRaw(borrowWhole, XUSD_DECIMALS);
      ixs.push(
        openPositionIx({
          user: publicKey,
          collateralMint: new PublicKey(selected.mint),
          counter,
          collateralAmount: colRaw,
          loanAmount: loanRaw,
        }),
      );

      const sig = await send({
        title: `Open ${symbol} position`,
        detailLines: [
          ['Action', `Deposit ${colWhole} ${symbol} · borrow ${borrowWhole.toLocaleString()} XUSD`],
          ['Health factor', health === Infinity ? '∞' : `${health.toFixed(2)}×`],
          ['Liquidation price', fmtUSD(liqPrice)],
        ],
        ixs,
        computeUnits: 400_000,
        onConfirmed: () => {
          refresh();
          setColInput('');
          setBorrowInput('');
        },
      });
      if (sig) {
        // soft redirect to overview after the user clicks Done in the overlay
        setTimeout(() => nav('/app'), 200);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <MLabel>Borrow XUSD</MLabel>
          <h1 style={{ fontSize: 30, fontWeight: 500, margin: '4px 0 0', letterSpacing: '-0.025em' }}>
            Open a position
          </h1>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr 1fr', gap: 20 }}>
        {/* LEFT — collateral picker */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MLabel>Collateral</MLabel>
          {loading && allowed.length === 0 &&
            Array.from({ length: 2 }).map((_, i) => (
              <MCard key={i} padding={16}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <SkeletonCircle size={36} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Skeleton width={50} height={11} />
                    <Skeleton width={90} height={9} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <Skeleton width={70} height={11} />
                    <Skeleton width={42} height={9} />
                  </div>
                </div>
              </MCard>
            ))}
          {!loading && allowed.length === 0 && (
            <MCard>
              <div style={{ fontSize: 13, color: color.textDim }}>No collaterals available.</div>
            </MCard>
          )}
          {allowed.map((c) => {
            const sym = KNOWN_MINTS[c.mint.toBase58()]?.symbol ?? c.mint.toBase58().slice(0, 4);
            const brand = brandFor(sym);
            const active = selectedMint === c.mint.toBase58();
            return (
              <MCard
                key={c.mint.toBase58()}
                padding={16}
                style={{
                  cursor: 'pointer',
                  border: `1px solid ${active ? color.accent : color.border}`,
                  background: active ? 'rgba(124, 155, 255, 0.05)' : color.surface,
                  transition: 'all 150ms',
                }}
                onClick={() => setSelectedMint(c.mint.toBase58())}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} size={36} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{sym}</div>
                    <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>
                      max {Number(c.ltv) / 100}% LTV
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontFamily: font.mono }}>
                      ${priceToUsd(c.price).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>oracle</div>
                  </div>
                </div>
              </MCard>
            );
          })}
        </div>

        {/* CENTER — inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <MLabel>Deposit collateral</MLabel>
              <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>
                balance {balanceWhole.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol} ·{' '}
                <span style={{ color: color.accent, cursor: 'pointer' }} onClick={() => setColInput(String(balanceWhole))}>
                  max
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MonoInput value={colInput} onChange={setColInput} placeholder="0" />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  border: `1px solid ${color.borderHi}`,
                  borderRadius: radius.pill,
                }}
              >
                {selected && (
                  <CoinBadge
                    glyph={brandFor(symbol).glyph}
                    bg={brandFor(symbol).tint}
                    fg={brandFor(symbol).fg}
                    size={22}
                  />
                )}
                <span style={{ fontWeight: 500, fontSize: 14 }}>{symbol || '—'}</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: color.textDim, marginTop: 4, fontFamily: font.mono }}>≈ {fmtUSD(colUsd)}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
              {[0.25, 0.5, 0.75, 1].map((p, i) => (
                <span
                  key={i}
                  onClick={() => setColInput(String(balanceWhole * p))}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    border: `1px solid ${color.border}`,
                    borderRadius: radius.pill,
                    color: color.textDim,
                    fontFamily: font.mono,
                    cursor: 'pointer',
                  }}
                >
                  {p === 1 ? 'MAX' : `${p * 100}%`}
                </span>
              ))}
            </div>
          </MCard>

          <div style={{ textAlign: 'center', fontSize: 14, color: color.textMute, margin: '-2px 0' }}>↓</div>

          <MCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <MLabel>Borrow</MLabel>
              <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>
                max {maxBorrow.toLocaleString(undefined, { maximumFractionDigits: 2 })} XUSD
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MonoInput value={borrowInput} onChange={setBorrowInput} placeholder="0" c={color.accent} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  border: `1px solid ${color.borderHi}`,
                  borderRadius: radius.pill,
                }}
              >
                <CoinBadge glyph="$" bg={color.accentDim} fg={color.accent} size={22} />
                <span style={{ fontWeight: 500, fontSize: 14 }}>XUSD</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: color.textDim, marginTop: 4, fontFamily: font.mono }}>
              + fee {fmtUSD(fee, 2)} ({Number(COMMISSION_BPS) / 100}% one-time)
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>LTV</span>
                <span style={{ fontSize: 11.5, color: color.text, fontFamily: font.mono }}>
                  {ltvPct.toFixed(0)}% / {maxLtvPct.toFixed(0)}%
                </span>
              </div>
              <AnimBar
                pct={Math.min(100, (ltvPct / maxLtvPct) * 100)}
                fill={ltvPct > maxLtvPct * 0.9 ? color.amber : color.accent}
                height={6}
                delay={0}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10.5, color: color.textMute, fontFamily: font.mono }}>0%</span>
                <span style={{ fontSize: 10.5, color: color.textMute, fontFamily: font.mono }}>safe</span>
                <span style={{ fontSize: 10.5, color: color.textMute, fontFamily: font.mono }}>liq.</span>
              </div>
            </div>
          </MCard>
        </div>

        {/* RIGHT — summary + CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MCard>
            <MLabel style={{ marginBottom: 14 }}>Summary</MLabel>
            {([
              [
                'Health factor',
                health === Infinity ? <span>∞</span> : <TickerNum to={health} suffix="×" decimals={2} />,
                health === Infinity ? color.text : health < 1.5 ? color.amber : color.green,
              ],
              ['Liquidation price', liqPrice > 0 ? fmtUSD(liqPrice) : '—', color.text],
              ['Borrow APR', '0.00%', color.text],
              ['One-time fee', `${fmtUSD(fee, 2)} XUSD`, color.text],
              ['Network fee', '~0.00005 SOL', color.textDim],
            ] as const).map(([k, v, c], i, arr) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  fontSize: 13,
                  borderBottom: i < arr.length - 1 ? `1px solid ${color.border}` : 'none',
                }}
              >
                <span style={{ color: color.textDim }}>{k}</span>
                <span style={{ color: c, fontFamily: font.mono }}>{v}</span>
              </div>
            ))}
          </MCard>

          <MCard padding={16}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: color.accent,
                  marginTop: 7,
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: 12.5, color: color.textDim, lineHeight: 1.5 }}>
                If {symbol} drops below{' '}
                <span style={{ color: color.text }}>{liqPrice > 0 ? fmtUSD(liqPrice) : '—'}</span>, your collateral can be sold to repay the debt. Add more {symbol} any time to reduce risk.
              </div>
            </div>
          </MCard>

          <button
            disabled={!valid || busy}
            onClick={submit}
            style={btnAccent({
              width: '100%',
              padding: '14px 0',
              fontSize: 14,
              opacity: !valid || busy ? 0.4 : 1,
              cursor: !valid || busy ? 'not-allowed' : 'pointer',
              marginTop: 4,
            })}
          >
            {!selected
              ? 'Pick a collateral'
              : !validColAmount
              ? 'Enter collateral amount'
              : !validBorrowAmount
              ? 'Enter borrow amount'
              : busy
              ? 'Submitting…'
              : `Borrow ${borrowWhole.toLocaleString()} XUSD →`}
          </button>
          <button style={btnGhost({ width: '100%' })} onClick={() => nav('/app')}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
