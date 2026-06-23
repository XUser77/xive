import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { color, font, radius } from "../ui/tokens";
import {
  CoinBadge,
  MCard,
  MLabel,
  MonoInput,
  PageFade,
  btnAccent,
  fmtUSD,
} from "../ui/primitives";
import { Shell } from "../ui/Shell";
import { ConnectButton } from "../ui/ConnectButton";
import { USDC_MINT, USDC_DECIMALS, XUSD_MINT, XUSD_DECIMALS } from "../config";
import { useUserData, rawToWhole, wholeToRaw, balanceOf } from "../hooks/useUserData";
import { useTxSender } from "../hooks/useTxSender";
import { buyUsdcIx, buyXusdIx, SWAP_FEE_BPS, SWAP_MIN_AMOUNT } from "../vaultInstructions";

type Side = "XUSD" | "USDC";

const TOKENS: Record<Side, { mint: string; decimals: number; glyph: string }> = {
  XUSD: { mint: XUSD_MINT.toBase58(), decimals: XUSD_DECIMALS, glyph: "$" },
  USDC: { mint: USDC_MINT.toBase58(), decimals: USDC_DECIMALS, glyph: "$" },
};

export default function SwapPage() {
  const { connected } = useWallet();
  return <Shell>{connected ? <Swap /> : <Locked />}</Shell>;
}

function Locked() {
  return (
    <PageFade style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <MCard padding={32} style={{ textAlign: "center", maxWidth: 460 }}>
        <MLabel>Swap</MLabel>
        <h2 style={{ fontSize: 24, fontWeight: 500, margin: "6px 0 12px", letterSpacing: "-0.02em" }}>
          Connect to swap
        </h2>
        <div style={{ fontSize: 14, color: color.textDim, marginBottom: 22, lineHeight: 1.55 }}>
          Swap between XUSD and USDC at 1:1 through the protocol vault, with a 0.05% fee.
        </div>
        <ConnectButton />
      </MCard>
    </PageFade>
  );
}

function Swap() {
  const { publicKey } = useWallet();
  const { balances, refresh } = useUserData();
  const { send } = useTxSender();

  const [from, setFrom] = useState<Side>("USDC");
  const to: Side = from === "USDC" ? "XUSD" : "USDC";
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const fromTok = TOKENS[from];

  const fromBal = balanceOf(balances, fromTok.mint);
  const fromBalWhole = fromBal ? rawToWhole(fromBal.rawBalance, fromTok.decimals) : 0;

  const amt = parseFloat(amount) || 0;
  const feeWhole = (amt * Number(SWAP_FEE_BPS)) / 10_000;
  const receive = Math.max(0, amt - feeWhole); // 1:1 minus fee (both 6 decimals)

  const minWhole = Number(SWAP_MIN_AMOUNT) / 10 ** fromTok.decimals;
  const tooSmall = amt > 0 && amt < minWhole;
  const insufficient = amt > fromBalWhole + 1e-9;
  const valid = amt > 0 && !tooSmall && !insufficient;

  const flip = () => {
    setFrom(to);
    setAmount("");
  };

  const submit = async () => {
    if (!valid || !publicKey) return;
    setBusy(true);
    try {
      const raw = wholeToRaw(amt, fromTok.decimals);
      const ix = from === "XUSD"
        ? buyUsdcIx({ user: publicKey, amount: raw })
        : buyXusdIx({ user: publicKey, amount: raw });
      await send({
        title: `Swap ${from} → ${to}`,
        detailLines: [
          ["Pay", `${amt.toLocaleString()} ${from}`],
          ["Receive", `${receive.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to}`],
          ["Fee", `${fmtUSD(feeWhole, 4)} (${Number(SWAP_FEE_BPS) / 100}%)`],
        ],
        ixs: [ix],
        onConfirmed: () => {
          refresh();
          setAmount("");
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <MLabel>Swap</MLabel>
        <h1 style={{ fontSize: 30, fontWeight: 500, margin: "4px 0 0", letterSpacing: "-0.025em" }}>
          XUSD ⇄ USDC
        </h1>
      </div>

      <div style={{ maxWidth: 460 }}>
        <MCard>
          {/* FROM */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <MLabel>You pay</MLabel>
            <div style={{ fontSize: 11.5, color: color.textDim, fontFamily: font.mono }}>
              balance {fromBalWhole.toLocaleString(undefined, { maximumFractionDigits: 4 })} {from} ·{" "}
              <span style={{ color: color.accent, cursor: "pointer" }} onClick={() => setAmount(String(fromBalWhole))}>
                max
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <MonoInput value={amount} onChange={setAmount} placeholder="0" />
            <TokenPill side={from} />
          </div>

          {/* flip */}
          <div style={{ display: "flex", justifyContent: "center", margin: "14px 0" }}>
            <button
              onClick={flip}
              title="Flip direction"
              style={{
                width: 34,
                height: 34,
                borderRadius: radius.pill,
                border: `1px solid ${color.borderHi}`,
                background: color.surface,
                color: color.text,
                cursor: "pointer",
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              ⇅
            </button>
          </div>

          {/* TO */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <MLabel>You receive</MLabel>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                flex: 1,
                fontFamily: font.mono,
                fontSize: 28,
                color: receive > 0 ? color.text : color.textMute,
                letterSpacing: "-0.02em",
              }}
            >
              {receive > 0 ? receive.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0"}
            </div>
            <TokenPill side={to} />
          </div>

          {/* details */}
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: `1px solid ${color.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {[
              ["Rate", "1.0000"],
              ["Fee", `${fmtUSD(feeWhole, 4)} ${from} · ${Number(SWAP_FEE_BPS) / 100}%`],
              ["Min received", receive > 0 ? `${receive.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to}` : "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: color.textDim }}>{k}</span>
                <span style={{ color: color.text, fontFamily: font.mono }}>{v}</span>
              </div>
            ))}
          </div>

          <button
            disabled={!valid || busy}
            onClick={submit}
            style={btnAccent({
              width: "100%",
              padding: "14px 0",
              fontSize: 14,
              marginTop: 18,
              opacity: !valid || busy ? 0.4 : 1,
              cursor: !valid || busy ? "not-allowed" : "pointer",
            })}
          >
            {busy
              ? "Submitting…"
              : insufficient
              ? `Insufficient ${from}`
              : tooSmall
              ? `Min ${minWhole} ${from}`
              : amt > 0
              ? `Swap ${from} → ${to} →`
              : "Enter amount"}
          </button>
        </MCard>

        <div style={{ fontSize: 12, color: color.textMute, marginTop: 12, lineHeight: 1.5, textAlign: "center" }}>
          Swaps settle 1:1 against the protocol vault's reserves. Large swaps may fail if the vault lacks {to} liquidity.
        </div>
      </div>
    </>
  );
}

function TokenPill({ side }: { side: Side }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        border: `1px solid ${color.borderHi}`,
        borderRadius: radius.pill,
        flexShrink: 0,
      }}
    >
      <CoinBadge glyph={TOKENS[side].glyph} bg={color.accentDim} fg={color.accent} size={22} />
      <span style={{ fontWeight: 500, fontSize: 14 }}>{side}</span>
    </div>
  );
}
