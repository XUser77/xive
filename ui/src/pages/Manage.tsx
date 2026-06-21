import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  btnAccent,
  btnDanger,
  btnGhost,
  fmtUSD,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { KNOWN_MINTS, XUSD_DECIMALS } from "../config";
import { useUserData, rawToWhole, wholeToRaw, balanceOf } from "../hooks/useUserData";
import { useTxSender } from "../hooks/useTxSender";
import {
  borrowIx,
  depositIx,
  repayIx,
  withdrawIx,
} from "../xiveInstructions";
import type { Position } from "../positions";
import { type Collateral, priceToUsd } from "../collateral";

type TabKey = 'add' | 'withdraw' | 'borrow' | 'repay' | 'close';

export default function ManagePage() {
  const { connected } = useWallet();
  return <Shell>{connected ? <Manage /> : <Locked />}</Shell>;
}

function Locked() {
  return (
    <PageFade style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <MCard padding={32} style={{ textAlign: 'center', maxWidth: 460 }}>
        <MLabel>Position</MLabel>
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: '6px 0 12px', letterSpacing: '-0.02em' }}>
          Connect to manage
        </h2>
        <ConnectButton />
      </MCard>
    </PageFade>
  );
}

function Manage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { positions, collaterals, balances, refresh, loading } = useUserData();
  const { send } = useTxSender();
  const { publicKey } = useWallet();

  const [tab, setTab] = useState<TabKey>('add');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const position = useMemo(() => {
    return positions.find((p) => p.address.toBase58() === id);
  }, [positions, id]);

  const collateral = useMemo(() => {
    if (!position) return undefined;
    return collaterals.find((c) => c.mint.toBase58() === position.collateralMint.toBase58());
  }, [collaterals, position]);

  if (!position || !collateral) {
    if (loading) return <ManageSkeleton onBack={() => nav('/app')} />;
    return (
      <PageFade>
        <MCard padding={32}>
          <MLabel>Position not found</MLabel>
          <div style={{ fontSize: 14, color: color.textDim, margin: '10px 0 18px' }}>
            We couldn't locate this position. It may have been closed.
          </div>
          <button style={btnGhost()} onClick={() => nav('/app')}>← Back to overview</button>
        </MCard>
      </PageFade>
    );
  }

  return (
    <ManageInner
      position={position}
      collateral={collateral}
      tab={tab}
      setTab={setTab}
      amount={amount}
      setAmount={setAmount}
      busy={busy}
      setBusy={setBusy}
      onAfter={() => {
        refresh();
        setAmount('');
      }}
      send={send}
      publicKey={publicKey!}
      balances={balances}
      onBack={() => nav('/app')}
    />
  );
}

function ManageInner({
  position,
  collateral,
  tab,
  setTab,
  amount,
  setAmount,
  busy,
  setBusy,
  onAfter,
  send,
  publicKey,
  balances,
  onBack,
}: {
  position: Position;
  collateral: Collateral;
  tab: TabKey;
  setTab: (t: TabKey) => void;
  amount: string;
  setAmount: (v: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onAfter: () => void;
  send: ReturnType<typeof useTxSender>['send'];
  publicKey: PublicKey;
  balances: ReturnType<typeof useUserData>['balances'];
  onBack: () => void;
}) {
  const symbol = KNOWN_MINTS[collateral.mint.toBase58()]?.symbol ?? 'COL';
  const decimals = KNOWN_MINTS[collateral.mint.toBase58()]?.decimals ?? 8;
  const brand = brandFor(symbol);
  const colWhole = rawToWhole(position.collateralAmount, decimals);
  const debtWhole = rawToWhole(position.loanAmount, XUSD_DECIMALS);
  const price = priceToUsd(collateral.price);
  const colUsd = colWhole * price;
  const maxLtv = Number(collateral.ltv) / 100;
  const liqLtv = Number(collateral.liquidationLtv) / 100;
  const ltvPct = colUsd > 0 ? (debtWhole / colUsd) * 100 : 0;
  const liqValue = colUsd * (liqLtv / 100);
  const health = debtWhole > 0 ? liqValue / debtWhole : Infinity;
  const liqPrice = colWhole > 0 && debtWhole > 0 ? debtWhole / (colWhole * (liqLtv / 100)) : 0;
  const atRisk = health < 1.2;

  const collateralBal = balanceOf(balances, collateral.mint.toBase58());
  const collateralBalWhole = collateralBal ? rawToWhole(collateralBal.rawBalance, collateralBal.decimals) : 0;
  const xusdBal = balances.find((b) => b.symbol === 'XUSD');
  const xusdBalWhole = xusdBal ? rawToWhole(xusdBal.rawBalance, XUSD_DECIMALS) : 0;

  const amt = parseFloat(amount) || 0;

  // Per-tab caps + previews
  let cap = 0;
  let symbolForInput = symbol;
  let action: () => Promise<void>;
  let label = '';
  let cta = '';
  let preview: [string, string][] = [];
  let canExecute = false;

  if (tab === 'add') {
    cap = collateralBalWhole;
    label = `Add collateral · balance ${cap.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`;
    cta = `Add ${amt} ${symbol}`;
    const newCol = colWhole + amt;
    const newColUsd = newCol * price;
    const newH = debtWhole > 0 ? (newColUsd * (liqLtv / 100)) / debtWhole : Infinity;
    const newLiq = newCol > 0 && debtWhole > 0 ? debtWhole / (newCol * (liqLtv / 100)) : 0;
    preview = [
      ['New collateral', `${newCol.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`],
      ['New health', newH === Infinity ? '∞' : `${newH.toFixed(2)}×`],
      ['New liq. price', newLiq > 0 ? fmtUSD(newLiq) : '—'],
    ];
    canExecute = amt > 0 && amt <= cap + 1e-9;
    action = async () => {
      const raw = wholeToRaw(amt, decimals);
      await send({
        title: `Add ${symbol} collateral`,
        detailLines: [['Action', `Add ${amt} ${symbol} to position`]],
        ixs: [
          depositIx({
            user: publicKey,
            position: position.address,
            collateralMint: collateral.mint,
            amount: raw,
          }),
        ],
        onConfirmed: onAfter,
      });
    };
  } else if (tab === 'withdraw') {
    // max safe = withdraw without going above max LTV
    const minColUsd = debtWhole > 0 ? debtWhole / (maxLtv / 100) : 0;
    const maxRemoveUsd = Math.max(0, colUsd - minColUsd);
    cap = price > 0 ? maxRemoveUsd / price : 0;
    label = `Withdraw collateral · max safe ${cap.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`;
    cta = `Withdraw ${amt} ${symbol}`;
    const newCol = colWhole - amt;
    const newColUsd = Math.max(0, newCol * price);
    const newH = debtWhole > 0 ? (newColUsd * (liqLtv / 100)) / debtWhole : Infinity;
    const newLiq = newCol > 0 && debtWhole > 0 ? debtWhole / (newCol * (liqLtv / 100)) : 0;
    preview = [
      ['New collateral', `${newCol.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`],
      ['New health', newH === Infinity ? '∞' : `${newH.toFixed(2)}×`],
      ['New liq. price', newLiq > 0 ? fmtUSD(newLiq) : '—'],
    ];
    canExecute = amt > 0 && amt <= cap + 1e-9;
    action = async () => {
      const raw = wholeToRaw(amt, decimals);
      await send({
        title: `Withdraw ${symbol}`,
        detailLines: [['Action', `Withdraw ${amt} ${symbol}`]],
        ixs: [
          withdrawIx({
            user: publicKey,
            position: position.address,
            collateralMint: collateral.mint,
            amount: raw,
          }),
        ],
        onConfirmed: onAfter,
      });
    };
  } else if (tab === 'borrow') {
    const maxBorrow = Math.max(0, (colUsd * (maxLtv / 100)) - debtWhole);
    cap = maxBorrow;
    symbolForInput = 'XUSD';
    label = `Borrow more XUSD · max ${cap.toLocaleString(undefined, { maximumFractionDigits: 2 })} XUSD`;
    cta = `Borrow ${amt} XUSD`;
    const newDebt = debtWhole + amt + (amt * 50) / 10_000;
    const newH = newDebt > 0 ? (colUsd * (liqLtv / 100)) / newDebt : Infinity;
    const newLiq = colWhole > 0 && newDebt > 0 ? newDebt / (colWhole * (liqLtv / 100)) : 0;
    preview = [
      ['New debt', `${newDebt.toLocaleString(undefined, { maximumFractionDigits: 2 })} XUSD`],
      ['New health', newH === Infinity ? '∞' : `${newH.toFixed(2)}×`],
      ['New liq. price', newLiq > 0 ? fmtUSD(newLiq) : '—'],
    ];
    canExecute = amt > 0 && amt + (amt * 50) / 10_000 <= cap + 1e-6;
    action = async () => {
      const raw = wholeToRaw(amt, XUSD_DECIMALS);
      await send({
        title: `Borrow more XUSD`,
        detailLines: [['Action', `Borrow ${amt} XUSD against ${symbol}`]],
        ixs: [
          borrowIx({
            user: publicKey,
            position: position.address,
            collateralMint: collateral.mint,
            amount: raw,
          }),
        ],
        onConfirmed: onAfter,
      });
    };
  } else if (tab === 'repay') {
    cap = Math.min(xusdBalWhole, debtWhole);
    symbolForInput = 'XUSD';
    label = `Repay debt · wallet ${xusdBalWhole.toLocaleString(undefined, { maximumFractionDigits: 2 })} XUSD`;
    cta = `Repay ${amt} XUSD`;
    const newDebt = Math.max(0, debtWhole - amt);
    const newH = newDebt > 0 ? (colUsd * (liqLtv / 100)) / newDebt : Infinity;
    const newLiq = colWhole > 0 && newDebt > 0 ? newDebt / (colWhole * (liqLtv / 100)) : 0;
    preview = [
      ['New debt', `${newDebt.toLocaleString(undefined, { maximumFractionDigits: 2 })} XUSD`],
      ['New health', newH === Infinity ? '∞' : `${newH.toFixed(2)}×`],
      ['New liq. price', newLiq > 0 ? fmtUSD(newLiq) : '—'],
    ];
    canExecute = amt > 0 && amt <= cap + 1e-6;
    action = async () => {
      const raw = wholeToRaw(amt, XUSD_DECIMALS);
      await send({
        title: `Repay XUSD`,
        detailLines: [['Action', `Repay ${amt} XUSD`]],
        ixs: [repayIx({ user: publicKey, position: position.address, amount: raw })],
        onConfirmed: onAfter,
      });
    };
  } else {
    // close
    cap = 0;
    label = '';
    cta = '';
    preview = [];
    canExecute = false;
    action = async () => {
      // Compose: repay full debt then withdraw all collateral, in one tx.
      const debtRaw = position.loanAmount;
      const colRaw = position.collateralAmount;
      await send({
        title: `Close ${symbol} position`,
        detailLines: [
          ['Repay', `${debtWhole.toLocaleString()} XUSD`],
          ['Receive back', `${colWhole.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`],
        ],
        ixs: [
          repayIx({ user: publicKey, position: position.address, amount: debtRaw }),
          withdrawIx({
            user: publicKey,
            position: position.address,
            collateralMint: collateral.mint,
            amount: colRaw,
          }),
        ],
        onConfirmed: onAfter,
      });
    };
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ fontSize: 12, color: color.textDim, marginBottom: 12, fontFamily: font.mono }}>
        <span style={{ cursor: 'pointer' }} onClick={onBack}>Overview</span> / {symbol} position
      </div>

      {atRisk && (
        <div
          style={{
            padding: '14px 18px',
            marginBottom: 20,
            borderRadius: radius.xl,
            background: 'rgba(230, 180, 80, 0.08)',
            border: `1px solid rgba(230, 180, 80, 0.25)`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 99,
              background: 'rgba(230, 180, 80, 0.16)',
              color: color.amber,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            !
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: color.amber }}>
              Position is at risk of liquidation
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(230, 180, 80, 0.75)', marginTop: 2 }}>
              Health factor is {health.toFixed(2)}×. Add collateral or repay to stay safe.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnAccent({ padding: '8px 12px', fontSize: 12.5 })} onClick={() => setTab('add')}>
              Add collateral
            </button>
            <button style={btnGhost({ padding: '8px 12px', fontSize: 12.5 })} onClick={() => setTab('repay')}>
              Repay
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20 }}>
        {/* LEFT — summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
            <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} size={44} />
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 24, fontWeight: 500, margin: 0, letterSpacing: '-0.02em' }}>
                {symbol} position
              </h1>
              <div style={{ fontSize: 12, color: color.textDim, fontFamily: font.mono }}>
                {position.address.toBase58().slice(0, 8)}…
              </div>
            </div>
            <div
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 99,
                background: atRisk ? 'rgba(230, 180, 80, 0.12)' : 'rgba(95, 194, 138, 0.12)',
                color: atRisk ? color.amber : color.green,
                fontFamily: font.mono,
                letterSpacing: '0.04em',
              }}
            >
              ● {atRisk ? 'At risk' : 'Healthy'}
            </div>
          </div>

          <MCard>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <Stat label="Collateral" main={`${colWhole.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`} sub={fmtUSD(colUsd)} />
              <Stat label="Borrowed" main={fmtUSD(debtWhole, 2)} sub="XUSD" />
              <Stat
                label="Health factor"
                main={health === Infinity ? '∞' : `${health.toFixed(2)}×`}
                sub=""
                color={health === Infinity ? color.text : health < 1.5 ? color.amber : color.green}
              />
              <Stat
                label="Liquidation price"
                main={liqPrice > 0 ? fmtUSD(liqPrice) : '—'}
                sub={`now ${fmtUSD(price)}`}
              />
            </div>
          </MCard>

          <MCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <MLabel>LTV</MLabel>
              <span style={{ fontSize: 12, color: color.text, fontFamily: font.mono }}>
                {ltvPct.toFixed(1)}% / {maxLtv.toFixed(0)}% max
              </span>
            </div>
            <AnimBar
              pct={Math.min(100, (ltvPct / maxLtv) * 100)}
              fill={atRisk ? color.amber : color.accent}
              height={6}
              delay={300}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 10.5, color: color.textMute, fontFamily: font.mono }}>0%</span>
              <span style={{ fontSize: 10.5, color: color.textMute, fontFamily: font.mono }}>{(maxLtv / 2).toFixed(0)}%</span>
              <span style={{ fontSize: 10.5, color: color.textMute, fontFamily: font.mono }}>{liqLtv.toFixed(0)}% liq.</span>
            </div>
          </MCard>
        </div>

        {/* RIGHT — tabbed actions */}
        <div>
          <div
            style={{
              display: 'flex',
              gap: 0,
              padding: 4,
              background: color.surface,
              borderRadius: radius.lg,
              border: `1px solid ${color.border}`,
              marginBottom: 12,
            }}
          >
            {([
              ['add', 'Add'],
              ['withdraw', 'Withdraw'],
              ['borrow', 'Borrow'],
              ['repay', 'Repay'],
              ['close', 'Close'],
            ] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setTab(k);
                  setAmount('');
                }}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: radius.md,
                  fontSize: 12.5,
                  fontWeight: 500,
                  fontFamily: font.display,
                  border: 'none',
                  cursor: 'pointer',
                  background: tab === k ? color.surfaceHi : 'transparent',
                  color: tab === k ? color.text : color.textDim,
                }}
              >
                {l}
              </button>
            ))}
          </div>

          {tab === 'close' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <MCard>
                <MLabel style={{ marginBottom: 10 }}>Close position</MLabel>
                <div style={{ fontSize: 13.5, color: color.textDim, lineHeight: 1.55, marginBottom: 14 }}>
                  Repay your full{' '}
                  <span style={{ color: color.text, fontFamily: font.mono }}>
                    {fmtUSD(debtWhole, 2)} XUSD
                  </span>{' '}
                  debt and withdraw{' '}
                  <span style={{ color: color.text, fontFamily: font.mono }}>
                    {colWhole.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
                  </span>{' '}
                  back to your wallet.
                </div>
                <div style={{ borderTop: `1px solid ${color.border}`, paddingTop: 8 }}>
                  {[
                    ['Repay', `${fmtUSD(debtWhole, 2)} XUSD`],
                    ['Receive back', `${colWhole.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`],
                  ].map(([k, v], i, arr) => (
                    <div
                      key={k}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '8px 0',
                        fontSize: 13,
                        borderBottom: i < arr.length - 1 ? `1px solid ${color.border}` : 'none',
                      }}
                    >
                      <span style={{ color: color.textDim }}>{k}</span>
                      <span style={{ fontFamily: font.mono }}>{v}</span>
                    </div>
                  ))}
                </div>
              </MCard>
              <MCard padding={14}>
                <div style={{ fontSize: 12, color: color.textDim, lineHeight: 1.5 }}>
                  Closing this position is final. You can always open a new one later.
                </div>
              </MCard>
              <button
                disabled={busy || debtWhole > xusdBalWhole}
                onClick={submit}
                style={btnDanger({
                  width: '100%',
                  padding: '13px 0',
                  fontSize: 14,
                  opacity: busy || debtWhole > xusdBalWhole ? 0.4 : 1,
                  cursor: busy || debtWhole > xusdBalWhole ? 'not-allowed' : 'pointer',
                })}
              >
                {debtWhole > xusdBalWhole
                  ? `Need ${fmtUSD(debtWhole - xusdBalWhole, 2)} more XUSD`
                  : busy
                  ? 'Submitting…'
                  : `Close position — repay ${fmtUSD(debtWhole, 2)} XUSD`}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <MCard>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <MLabel>{label.split('·')[0].trim()}</MLabel>
                  <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>
                    {label.split('·')[1]?.trim()}
                    {' · '}
                    <span style={{ color: color.accent, cursor: 'pointer' }} onClick={() => setAmount(String(cap))}>
                      max
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <MonoInput value={amount} onChange={setAmount} placeholder="0" fontSize={32} />
                  <div
                    style={{
                      padding: '6px 12px',
                      border: `1px solid ${color.borderHi}`,
                      borderRadius: radius.pill,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {symbolForInput}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  {[0.25, 0.5, 0.75, 1].map((p, i) => (
                    <span
                      key={i}
                      onClick={() => setAmount(String(cap * p))}
                      style={{
                        fontSize: 11,
                        padding: '3px 10px',
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
              <MCard>
                {preview.map(([k, v], i, arr) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '9px 0',
                      fontSize: 13,
                      borderBottom: i < arr.length - 1 ? `1px solid ${color.border}` : 'none',
                    }}
                  >
                    <span style={{ color: color.textDim }}>{k}</span>
                    <span style={{ fontFamily: font.mono }}>{v}</span>
                  </div>
                ))}
              </MCard>
              <button
                disabled={!canExecute || busy}
                onClick={submit}
                style={btnAccent({
                  width: '100%',
                  padding: '13px 0',
                  fontSize: 14,
                  opacity: !canExecute || busy ? 0.4 : 1,
                  cursor: !canExecute || busy ? 'not-allowed' : 'pointer',
                })}
              >
                {busy ? 'Submitting…' : amt > 0 ? `${cta} →` : 'Enter amount'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ManageSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <PageFade>
      <div style={{ fontSize: 12, color: color.textDim, marginBottom: 12, fontFamily: font.mono }}>
        <span style={{ cursor: 'pointer' }} onClick={onBack}>Overview</span> /{' '}
        <span style={{ display: 'inline-block', verticalAlign: 'middle' }}>
          <Skeleton width={140} height={10} />
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
            <SkeletonCircle size={44} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Skeleton width={180} height={18} />
              <Skeleton width={120} height={10} />
            </div>
            <Skeleton width={84} height={20} radius={99} />
          </div>

          <MCard>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width={80} height={9} />
                  <Skeleton width={140} height={22} />
                  <Skeleton width={70} height={9} />
                </div>
              ))}
            </div>
          </MCard>

          <MCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Skeleton width={40} height={9} />
              <Skeleton width={120} height={10} />
            </div>
            <Skeleton width="100%" height={6} />
          </MCard>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton width="100%" height={36} radius={8} />
          <MCard>
            <Skeleton width={120} height={10} style={{ marginBottom: 16 }} />
            <Skeleton width="100%" height={36} />
          </MCard>
          <MCard>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderBottom: i < 2 ? `1px solid ${color.border}` : 'none',
                }}
              >
                <Skeleton width={90} height={10} />
                <Skeleton width={120} height={10} />
              </div>
            ))}
          </MCard>
          <Skeleton width="100%" height={48} radius={6} />
        </div>
      </div>
    </PageFade>
  );
}

function Stat({
  label,
  main,
  sub,
  color: c,
}: {
  label: string;
  main: string;
  sub: string;
  color?: string;
}) {
  return (
    <div>
      <MLabel>{label}</MLabel>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 26,
          marginTop: 4,
          letterSpacing: '-0.02em',
          color: c ?? color.text,
        }}
      >
        {main}
      </div>
      {sub && (
        <div style={{ fontFamily: font.mono, fontSize: 12, color: color.textMute, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
