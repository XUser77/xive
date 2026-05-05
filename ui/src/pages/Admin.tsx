import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { color, font, radius, brandFor } from "../ui/tokens";
import {
  CoinBadge,
  MCard,
  MLabel,
  MonoInput,
  PageFade,
  Skeleton,
  SkeletonCircle,
  btnAccent,
  fmtUSD,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { KNOWN_MINTS } from "../config";
import { useUserData, rawToWhole, wholeToRaw } from "../hooks/useUserData";
import { useTxSender } from "../hooks/useTxSender";
import { setPriceIx } from "../xiveInstructions";
import { surfnetSetAccount, surfnetSetTokenAccount } from "../surfnet";

export default function AdminPage() {
  const { connected } = useWallet();
  return <Shell>{connected ? <Admin /> : <Locked />}</Shell>;
}

function Locked() {
  return (
    <PageFade style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <MCard padding={32} style={{ textAlign: 'center', maxWidth: 460 }}>
        <MLabel>Admin</MLabel>
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: '6px 0 12px', letterSpacing: '-0.02em' }}>
          Connect to access admin
        </h2>
        <ConnectButton />
      </MCard>
    </PageFade>
  );
}

function Admin() {
  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <MLabel>Admin · devnet</MLabel>
        <h1 style={{ fontSize: 30, fontWeight: 500, margin: '4px 0 0', letterSpacing: '-0.025em' }}>
          Operator tools
        </h1>
        <div style={{ fontSize: 13, color: color.textDim, marginTop: 6 }}>
          Update oracle prices and fund the connected wallet for development.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <PriceSetter />
        <SurfnetFunder />
      </div>
    </>
  );
}

// ---------- Oracle / price setter ----------

function PriceSetter() {
  const { publicKey } = useWallet();
  const { collaterals, refresh, loading } = useUserData();
  const { send } = useTxSender();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const submit = async (mint: PublicKey) => {
    if (!publicKey) return;
    const key = mint.toBase58();
    const raw = drafts[key];
    if (!raw) return;
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value < 0) return;
    setBusy(key);
    try {
      await send({
        title: 'Set oracle price',
        detailLines: [['Mint', `${KNOWN_MINTS[key]?.symbol ?? key.slice(0, 8)}`], ['Price', fmtUSD(value)]],
        ixs: [setPriceIx({ payer: publicKey, collateralMint: mint, price: BigInt(Math.round(value)) })],
        onConfirmed: () => {
          refresh();
          setDrafts((d) => ({ ...d, [key]: '' }));
        },
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <MCard padding={0}>
      <div
        style={{
          padding: '16px 20px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <MLabel>Oracle prices</MLabel>
        <span style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
          {collaterals.length} asset{collaterals.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && collaterals.length === 0 &&
        Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            style={{
              padding: '14px 20px',
              borderTop: i > 0 ? `1px solid ${color.border}` : 'none',
              display: 'grid',
              gridTemplateColumns: '40px 1fr 1fr auto',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <SkeletonCircle size={32} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton width={50} height={11} />
              <Skeleton width={90} height={9} />
            </div>
            <Skeleton width="100%" height={28} radius={8} />
            <Skeleton width={60} height={28} radius={6} />
          </div>
        ))}
      {!loading && collaterals.length === 0 && (
        <div style={{ padding: '24px 20px', fontSize: 13, color: color.textDim }}>
          No collaterals registered.
        </div>
      )}

      {collaterals.map((c, i) => {
        const symbol = KNOWN_MINTS[c.mint.toBase58()]?.symbol ?? c.mint.toBase58().slice(0, 4);
        const brand = brandFor(symbol);
        const key = c.mint.toBase58();
        const draft = drafts[key] ?? '';
        return (
          <div
            key={key}
            style={{
              padding: '14px 20px',
              borderTop: i > 0 ? `1px solid ${color.border}` : 'none',
              display: 'grid',
              gridTemplateColumns: '40px 1fr 1fr auto',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} size={32} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{symbol}</div>
              <div style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
                current ${Number(c.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                border: `1px solid ${color.border}`,
                borderRadius: radius.lg,
                background: color.bg,
              }}
            >
              <span style={{ fontFamily: font.mono, color: color.textMute }}>$</span>
              <MonoInput
                value={draft}
                onChange={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
                placeholder={String(c.price)}
                fontSize={14}
              />
            </div>
            <button
              disabled={!draft || busy === key}
              onClick={() => submit(c.mint)}
              style={btnAccent({
                padding: '6px 12px',
                fontSize: 12,
                opacity: !draft || busy === key ? 0.4 : 1,
                cursor: !draft || busy === key ? 'not-allowed' : 'pointer',
              })}
            >
              {busy === key ? '…' : 'Set →'}
            </button>
          </div>
        );
      })}
    </MCard>
  );
}

// ---------- Surfnet funder ----------

type FundAsset = {
  symbol: string;
  decimals: number;
  mint?: PublicKey; // undefined = native SOL
};

function SurfnetFunder() {
  const { publicKey } = useWallet();
  const { balances, refresh } = useUserData();

  const assets: FundAsset[] = useMemo(() => {
    const known: FundAsset[] = [{ symbol: 'SOL', decimals: 9 }];
    for (const [mintStr, meta] of Object.entries(KNOWN_MINTS)) {
      known.push({ symbol: meta.symbol, decimals: meta.decimals, mint: new PublicKey(mintStr) });
    }
    return known;
  }, []);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fund = async (asset: FundAsset) => {
    if (!publicKey) return;
    setError(null);
    const key = asset.symbol;
    const raw = drafts[key];
    if (!raw) return;
    const whole = parseFloat(raw);
    if (!Number.isFinite(whole) || whole <= 0) return;
    setBusy(key);
    try {
      const rawAmount = wholeToRaw(whole, asset.decimals);
      if (asset.mint) {
        await surfnetSetTokenAccount(publicKey, asset.mint, rawAmount);
      } else {
        await surfnetSetAccount(publicKey, rawAmount);
      }
      setDrafts((d) => ({ ...d, [key]: '' }));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const balanceFor = (asset: FundAsset): number => {
    if (!asset.mint) {
      const sol = balances.find((b) => b.mint === 'SOL');
      return sol ? rawToWhole(sol.rawBalance, 9) : 0;
    }
    const b = balances.find((x) => x.mint === asset.mint!.toBase58());
    return b ? rawToWhole(b.rawBalance, asset.decimals) : 0;
  };

  return (
    <MCard padding={0}>
      <div
        style={{
          padding: '16px 20px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <MLabel>Surfnet wallet funder</MLabel>
        <span style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
          off-chain RPC cheat
        </span>
      </div>

      {assets.map((a, i) => {
        const brand = brandFor(a.symbol);
        const draft = drafts[a.symbol] ?? '';
        const bal = balanceFor(a);
        return (
          <div
            key={a.symbol}
            style={{
              padding: '14px 20px',
              borderTop: i > 0 ? `1px solid ${color.border}` : 'none',
              display: 'grid',
              gridTemplateColumns: '40px 1fr 1fr auto',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} size={32} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{a.symbol}</div>
              <div style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
                balance {bal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                border: `1px solid ${color.border}`,
                borderRadius: radius.lg,
                background: color.bg,
              }}
            >
              <MonoInput
                value={draft}
                onChange={(v) => setDrafts((d) => ({ ...d, [a.symbol]: v }))}
                placeholder="0"
                fontSize={14}
              />
              <span style={{ fontFamily: font.mono, color: color.textMute, fontSize: 12 }}>{a.symbol}</span>
            </div>
            <button
              disabled={!draft || busy === a.symbol}
              onClick={() => fund(a)}
              style={btnAccent({
                padding: '6px 12px',
                fontSize: 12,
                opacity: !draft || busy === a.symbol ? 0.4 : 1,
                cursor: !draft || busy === a.symbol ? 'not-allowed' : 'pointer',
              })}
            >
              {busy === a.symbol ? '…' : 'Fund →'}
            </button>
          </div>
        );
      })}

      {error && (
        <div
          style={{
            margin: '0 20px 16px',
            padding: '10px 12px',
            borderRadius: radius.lg,
            background: 'rgba(236, 111, 111, 0.08)',
            border: '1px solid rgba(236, 111, 111, 0.25)',
            color: color.red,
            fontSize: 12,
            fontFamily: font.mono,
          }}
        >
          {error}
        </div>
      )}
    </MCard>
  );
}
