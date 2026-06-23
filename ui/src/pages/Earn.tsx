import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";

import { color, font, radius } from "../ui/tokens";
import {
  AnimBar,
  CoinBadge,
  MCard,
  MLabel,
  MonoInput,
  PageFade,
  Skeleton,
  btnAccent,
  btnGhost,
  fmtUSD,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { LP_VAULT_DECIMALS, XUSD_DECIMALS } from "../config";
import { useUserData, rawToWhole, wholeToRaw } from "../hooks/useUserData";
import { useTxSender } from "../hooks/useTxSender";
import { vaultDepositIx, vaultWithdrawIx } from "../vaultInstructions";

export default function EarnPage() {
  const { connected } = useWallet();
  return <Shell>{connected ? <EarnFlow /> : <Locked />}</Shell>;
}

function Locked() {
  return (
    <PageFade style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <MCard padding={32} style={{ textAlign: 'center', maxWidth: 460 }}>
        <MLabel>Earn</MLabel>
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: '6px 0 12px', letterSpacing: '-0.02em' }}>
          Connect to earn yield
        </h2>
        <div style={{ fontSize: 14, color: color.textDim, marginBottom: 22, lineHeight: 1.55 }}>
          Deposit XUSD into the savings vault to earn yield from liquidation discounts.
        </div>
        <ConnectButton />
      </MCard>
    </PageFade>
  );
}

function EarnFlow() {
  const { publicKey } = useWallet();
  const { balances, vaultLpBalance, vaultNavRaw, lpSupply, refresh, loading } = useUserData();
  const { send } = useTxSender();
  const nav = useNavigate();
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const xusdBal = useMemo(() => {
    const b = balances.find((b) => b.symbol === 'XUSD');
    return b ? rawToWhole(b.rawBalance, XUSD_DECIMALS) : 0;
  }, [balances]);

  const vaultLpWhole = rawToWhole(vaultLpBalance, LP_VAULT_DECIMALS);
  const vaultTvlWhole = rawToWhole(vaultNavRaw, XUSD_DECIMALS);

  // User's claim = (their LP shares / total LP supply) × vault NAV.
  const sharePct = lpSupply > 0n ? (Number(vaultLpBalance) / Number(lpSupply)) * 100 : 0;
  const userClaim = (sharePct / 100) * vaultTvlWhole;

  const amt = parseFloat(amount) || 0;
  const cap = tab === 'deposit' ? xusdBal : vaultLpWhole;
  const valid = amt > 0 && amt <= cap + 1e-9;

  const submit = async () => {
    if (!valid || !publicKey) return;
    setBusy(true);
    try {
      if (tab === 'deposit') {
        const raw = wholeToRaw(amt, XUSD_DECIMALS);
        await send({
          title: 'Deposit XUSD',
          detailLines: [
            ['Action', `Deposit ${amt.toLocaleString()} XUSD`],
            ['New share', `${(sharePct + (vaultTvlWhole > 0 ? (amt / (vaultTvlWhole + amt)) * 100 : 100)).toFixed(2)}%`],
          ],
          ixs: [vaultDepositIx({ user: publicKey, amount: raw })],
          onConfirmed: () => {
            refresh();
            setAmount('');
          },
        });
      } else {
        const raw = wholeToRaw(amt, LP_VAULT_DECIMALS);
        await send({
          title: 'Withdraw XUSD',
          detailLines: [['Action', `Burn ${amt.toLocaleString()} LP shares`]],
          ixs: [vaultWithdrawIx({ user: publicKey, lpAmount: raw })],
          onConfirmed: () => {
            refresh();
            setAmount('');
          },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <MLabel>Savings vault</MLabel>
        <h1 style={{ fontSize: 30, fontWeight: 500, margin: '4px 0 0', letterSpacing: '-0.025em' }}>
          Earn yield on XUSD
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        {/* LEFT — vault stats + position */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MCard padding={28}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <MLabel>Current APY · 30d avg</MLabel>
                <div
                  style={{
                    fontSize: 64,
                    fontFamily: font.mono,
                    fontWeight: 400,
                    color: color.accent,
                    lineHeight: 1,
                    marginTop: 8,
                    letterSpacing: '-0.03em',
                  }}
                >
                  —
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: radius.sm,
                  background: 'rgba(95, 194, 138, 0.12)',
                  color: color.green,
                  fontFamily: font.mono,
                }}
              >
                ● LIVE
              </div>
            </div>
            <div
              style={{
                marginTop: 24,
                paddingTop: 18,
                borderTop: `1px solid ${color.border}`,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 14,
              }}
            >
              {[
                ['TVL', vaultTvlWhole > 0 ? fmtUSD(vaultTvlWhole) : '—'],
                ['Utilization', '—'],
                ['7d yield', '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <MLabel>{k}</MLabel>
                  <div style={{ fontSize: 18, fontFamily: font.mono, marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>
          </MCard>

          <MCard>
            {loading && vaultLpWhole === 0 ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <Skeleton width={70} height={9} />
                      <Skeleton width={120} height={22} />
                      <Skeleton width={90} height={9} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${color.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Skeleton width={70} height={9} />
                    <Skeleton width={50} height={9} />
                  </div>
                  <Skeleton width="100%" height={3} />
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>YOUR POSITION</div>
                    <div style={{ fontFamily: font.mono, fontSize: 26, marginTop: 4 }}>
                      {vaultLpWhole > 0 ? fmtUSD(userClaim) : '—'}
                    </div>
                    <div style={{ fontSize: 11.5, color: color.textMute, fontFamily: font.mono, marginTop: 2 }}>
                      {vaultLpWhole > 0 ? `${vaultLpWhole.toLocaleString()} LP` : 'no deposit yet'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>YIELD</div>
                    <div style={{ fontFamily: font.mono, fontSize: 26, marginTop: 4, color: color.green }}>
                      —
                    </div>
                    <div style={{ fontSize: 11.5, color: color.textMute, fontFamily: font.mono, marginTop: 2 }}>
                      pending
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${color.border}` }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11.5,
                      color: color.textDim,
                      fontFamily: font.mono,
                      marginBottom: 6,
                    }}
                  >
                    <span>vault share</span>
                    <span style={{ color: color.text }}>{sharePct.toFixed(3)}%</span>
                  </div>
                  <AnimBar pct={Math.min(100, sharePct)} height={3} delay={400} />
                </div>
              </>
            )}
          </MCard>

          <MCard padding={16}>
            <div style={{ fontSize: 12.5, color: color.textDim, lineHeight: 1.5 }}>
              Yield comes from positions the vault liquidates at a discount. No lockup; withdraw at any time.
            </div>
          </MCard>
        </div>

        {/* RIGHT — deposit / withdraw tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              background: color.surface,
              borderRadius: radius.lg,
              border: `1px solid ${color.border}`,
            }}
          >
            {([['deposit', 'Deposit'], ['withdraw', 'Withdraw']] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setTab(k);
                  setAmount('');
                }}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: radius.md,
                  fontSize: 13,
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

          <MCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <MLabel>{tab === 'deposit' ? 'Amount' : 'Withdraw'}</MLabel>
              <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>
                {tab === 'deposit' ? `balance ${xusdBal.toLocaleString(undefined, { maximumFractionDigits: 2 })} XUSD` : `available ${vaultLpWhole.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                {' · '}
                <span style={{ color: color.accent, cursor: 'pointer' }} onClick={() => setAmount(String(cap))}>max</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MonoInput value={amount} onChange={setAmount} placeholder="0" />
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
                <span style={{ fontSize: 14, fontWeight: 500 }}>{tab === 'deposit' ? 'XUSD' : 'LP'}</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: color.textDim, marginTop: 4, fontFamily: font.mono }}>
              {tab === 'deposit' ? `≈ ${fmtUSD(amt, 2)}` : 'redeems XUSD pro-rata'}
            </div>
          </MCard>

          {tab === 'deposit' && (
            <MCard>
              <MLabel style={{ marginBottom: 14 }}>Projected earnings</MLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                {[['1m', '—'], ['6m', '—'], ['1y', '—']].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>{k}</div>
                    <div style={{ fontSize: 18, fontFamily: font.mono, marginTop: 2, color: color.green }}>{v}</div>
                  </div>
                ))}
              </div>
            </MCard>
          )}

          <button
            disabled={!valid || busy}
            onClick={submit}
            style={btnAccent({
              width: '100%',
              padding: '14px 0',
              fontSize: 14,
              opacity: !valid || busy ? 0.4 : 1,
              cursor: !valid || busy ? 'not-allowed' : 'pointer',
            })}
          >
            {busy
              ? 'Submitting…'
              : tab === 'deposit'
              ? `Deposit ${amt > 0 ? amt.toLocaleString() : ''} XUSD →`
              : `Withdraw ${amt > 0 ? amt.toLocaleString() : ''} LP →`}
          </button>
          <button style={btnGhost({ width: '100%' })} onClick={() => nav('/app')}>
            Back to overview
          </button>
        </div>
      </div>
    </>
  );
}
