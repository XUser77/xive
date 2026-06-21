import { useMemo, useState, type CSSProperties } from "react";
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
  btnDanger,
  btnGhost,
  fmtUSD,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { KNOWN_MINTS } from "../config";
import { useUserData, rawToWhole, wholeToRaw } from "../hooks/useUserData";
import { useTxSender } from "../hooks/useTxSender";
import { setPriceIx, updateCollateralIx } from "../xiveInstructions";
import { surfnetSetAccount, surfnetSetTokenAccount } from "../surfnet";
import { priceToUsd, usdToPrice, type Collateral } from "../collateral";

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
          Add, remove and price collaterals, and fund the connected wallet for development.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <CollateralManager />
        <SurfnetFunder />
      </div>
    </>
  );
}

// ---------- Collateral manager ----------

type Send = ReturnType<typeof useTxSender>['send'];

// Parse a user-typed percentage (0–100) into validated basis points, or null.
function pctToBps(s: string): number | null {
  const v = parseFloat(s);
  if (!Number.isFinite(v) || v < 0 || v > 100) return null;
  return Math.round(v * 100);
}

const fieldBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  background: color.bg,
};

function CollateralManager() {
  const { publicKey } = useWallet();
  const { collaterals, refresh, loading } = useUserData();
  const { send } = useTxSender();

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
        <MLabel>Collaterals</MLabel>
        <span style={{ fontSize: 11, color: color.textMute, fontFamily: font.mono }}>
          {collaterals.length} asset{collaterals.length === 1 ? '' : 's'}
        </span>
      </div>

      {publicKey && <AddCollateralForm authority={publicKey} send={send} refresh={refresh} />}

      {loading && collaterals.length === 0 &&
        Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            style={{
              padding: '16px 20px',
              borderTop: `1px solid ${color.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <SkeletonCircle size={32} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton width={60} height={11} />
              <Skeleton width={120} height={9} />
            </div>
            <div style={{ flex: 1 }} />
            <Skeleton width={180} height={28} radius={8} />
          </div>
        ))}
      {!loading && collaterals.length === 0 && (
        <div style={{ padding: '24px 20px', fontSize: 13, color: color.textDim }}>
          No collaterals registered. Add one above.
        </div>
      )}

      {collaterals.map((c) =>
        publicKey ? (
          <CollateralRow
            key={c.mint.toBase58()}
            c={c}
            authority={publicKey}
            send={send}
            refresh={refresh}
          />
        ) : null,
      )}
    </MCard>
  );
}

function AddCollateralForm({
  authority,
  send,
  refresh,
}: {
  authority: PublicKey;
  send: Send;
  refresh: () => void;
}) {
  const [mint, setMint] = useState('');
  const [ltv, setLtv] = useState('');
  const [liq, setLiq] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    let mintKey: PublicKey;
    try {
      mintKey = new PublicKey(mint.trim());
    } catch {
      setError('Invalid mint address');
      return;
    }
    const ltvBps = pctToBps(ltv);
    const liqBps = pctToBps(liq);
    if (ltvBps === null || liqBps === null) {
      setError('LTV and liquidation LTV must be 0–100%');
      return;
    }
    if (ltvBps > liqBps) {
      setError('Max LTV must be ≤ liquidation LTV');
      return;
    }
    setBusy(true);
    try {
      await send({
        title: 'Add collateral',
        detailLines: [
          ['Mint', KNOWN_MINTS[mintKey.toBase58()]?.symbol ?? mintKey.toBase58().slice(0, 8)],
          ['Max LTV', `${ltvBps / 100}%`],
          ['Liquidation LTV', `${liqBps / 100}%`],
        ],
        ixs: [
          updateCollateralIx({
            authority,
            collateralMint: mintKey,
            enabled: true,
            ltv: ltvBps,
            liquidationLtv: liqBps,
          }),
        ],
        onConfirmed: () => {
          refresh();
          setMint('');
          setLtv('');
          setLiq('');
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '14px 20px', borderTop: `1px solid ${color.border}`, background: color.surface }}>
      <MLabel style={{ marginBottom: 8 }}>Add collateral</MLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px auto', gap: 10, alignItems: 'center' }}>
        <div style={fieldBox}>
          <MonoInput value={mint} onChange={setMint} placeholder="mint address" fontSize={13} />
        </div>
        <div style={fieldBox}>
          <MonoInput value={ltv} onChange={setLtv} placeholder="LTV %" fontSize={13} />
          <span style={{ fontFamily: font.mono, color: color.textMute, fontSize: 12 }}>%</span>
        </div>
        <div style={fieldBox}>
          <MonoInput value={liq} onChange={setLiq} placeholder="liq %" fontSize={13} />
          <span style={{ fontFamily: font.mono, color: color.textMute, fontSize: 12 }}>%</span>
        </div>
        <button
          disabled={!mint || !ltv || !liq || busy}
          onClick={submit}
          style={btnAccent({
            padding: '7px 14px',
            fontSize: 12,
            opacity: !mint || !ltv || !liq || busy ? 0.4 : 1,
            cursor: !mint || !ltv || !liq || busy ? 'not-allowed' : 'pointer',
          })}
        >
          {busy ? '…' : 'Add →'}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: color.red, fontFamily: font.mono }}>{error}</div>
      )}
    </div>
  );
}

function CollateralRow({
  c,
  authority,
  send,
  refresh,
}: {
  c: Collateral;
  authority: PublicKey;
  send: Send;
  refresh: () => void;
}) {
  const key = c.mint.toBase58();
  const symbol = KNOWN_MINTS[key]?.symbol ?? key.slice(0, 4);
  const brand = brandFor(symbol);

  const [price, setPrice] = useState('');
  const [ltv, setLtv] = useState(String(Number(c.ltv) / 100));
  const [liq, setLiq] = useState(String(Number(c.liquidationLtv) / 100));
  const [busy, setBusy] = useState<null | 'price' | 'config' | 'toggle'>(null);
  const [error, setError] = useState<string | null>(null);

  const setPriceAction = async () => {
    setError(null);
    const value = parseFloat(price);
    if (!Number.isFinite(value) || value < 0) {
      setError('Invalid price');
      return;
    }
    setBusy('price');
    try {
      await send({
        title: 'Set oracle price',
        detailLines: [['Mint', symbol], ['Price', fmtUSD(value)]],
        ixs: [setPriceIx({ authority, collateralMint: c.mint, price: usdToPrice(value) })],
        onConfirmed: () => {
          refresh();
          setPrice('');
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = async () => {
    setError(null);
    const ltvBps = pctToBps(ltv);
    const liqBps = pctToBps(liq);
    if (ltvBps === null || liqBps === null) {
      setError('LTV and liquidation LTV must be 0–100%');
      return;
    }
    if (ltvBps > liqBps) {
      setError('Max LTV must be ≤ liquidation LTV');
      return;
    }
    setBusy('config');
    try {
      await send({
        title: `Update ${symbol} config`,
        detailLines: [['Max LTV', `${ltvBps / 100}%`], ['Liquidation LTV', `${liqBps / 100}%`]],
        ixs: [
          updateCollateralIx({
            authority,
            collateralMint: c.mint,
            enabled: c.allowed,
            ltv: ltvBps,
            liquidationLtv: liqBps,
          }),
        ],
        onConfirmed: refresh,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // "Remove" = disable; toggling back re-enables. Preserves the committed LTVs.
  const toggleEnabled = async () => {
    setError(null);
    setBusy('toggle');
    try {
      await send({
        title: c.allowed ? `Disable ${symbol}` : `Enable ${symbol}`,
        detailLines: [['Collateral', symbol], ['Enabled', String(!c.allowed)]],
        ixs: [
          updateCollateralIx({
            authority,
            collateralMint: c.mint,
            enabled: !c.allowed,
            ltv: Number(c.ltv),
            liquidationLtv: Number(c.liquidationLtv),
          }),
        ],
        onConfirmed: refresh,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: '16px 20px', borderTop: `1px solid ${color.border}` }}>
      {/* header line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CoinBadge glyph={brand.glyph} bg={brand.tint} fg={brand.fg} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{symbol}</div>
          <div
            style={{
              fontSize: 11,
              color: color.textMute,
              fontFamily: font.mono,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {key}
          </div>
        </div>
        <span
          style={{
            fontSize: 10.5,
            padding: '3px 9px',
            borderRadius: 99,
            fontFamily: font.mono,
            letterSpacing: '0.04em',
            background: c.allowed ? 'rgba(95, 194, 138, 0.12)' : 'rgba(150, 150, 150, 0.12)',
            color: c.allowed ? color.green : color.textMute,
          }}
        >
          ● {c.allowed ? 'Enabled' : 'Disabled'}
        </span>
        <button
          disabled={busy === 'toggle'}
          onClick={toggleEnabled}
          style={(c.allowed ? btnDanger : btnGhost)({
            padding: '6px 12px',
            fontSize: 12,
            opacity: busy === 'toggle' ? 0.4 : 1,
            cursor: busy === 'toggle' ? 'not-allowed' : 'pointer',
          })}
        >
          {busy === 'toggle' ? '…' : c.allowed ? 'Disable' : 'Enable'}
        </button>
      </div>

      {/* controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        {/* config */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={fieldBox}>
            <span style={{ fontFamily: font.mono, color: color.textMute, fontSize: 11 }}>LTV</span>
            <MonoInput value={ltv} onChange={setLtv} placeholder="LTV %" fontSize={13} />
            <span style={{ fontFamily: font.mono, color: color.textMute, fontSize: 12 }}>%</span>
          </div>
          <div style={fieldBox}>
            <span style={{ fontFamily: font.mono, color: color.textMute, fontSize: 11 }}>liq</span>
            <MonoInput value={liq} onChange={setLiq} placeholder="liq %" fontSize={13} />
            <span style={{ fontFamily: font.mono, color: color.textMute, fontSize: 12 }}>%</span>
          </div>
          <button
            disabled={busy === 'config'}
            onClick={saveConfig}
            style={btnGhost({
              padding: '6px 12px',
              fontSize: 12,
              opacity: busy === 'config' ? 0.4 : 1,
              cursor: busy === 'config' ? 'not-allowed' : 'pointer',
            })}
          >
            {busy === 'config' ? '…' : 'Save'}
          </button>
        </div>

        {/* price */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ ...fieldBox, flex: 1 }}>
            <span style={{ fontFamily: font.mono, color: color.textMute }}>$</span>
            <MonoInput
              value={price}
              onChange={setPrice}
              placeholder={priceToUsd(c.price).toString()}
              fontSize={14}
            />
          </div>
          <button
            disabled={!price || busy === 'price'}
            onClick={setPriceAction}
            style={btnAccent({
              padding: '6px 12px',
              fontSize: 12,
              opacity: !price || busy === 'price' ? 0.4 : 1,
              cursor: !price || busy === 'price' ? 'not-allowed' : 'pointer',
            })}
          >
            {busy === 'price' ? '…' : 'Set price'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: color.red, fontFamily: font.mono }}>{error}</div>
      )}
    </div>
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
