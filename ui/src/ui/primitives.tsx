import {
  CSSProperties,
  Children,
  HTMLAttributes,
  ReactNode,
  useEffect,
  useState,
} from "react";
import { color, font, motion, radius } from "./tokens";

// ---------- format helpers ----------

export const fmtUSD = (n: number, dp = 0) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const fmtNum = (n: number, dp = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function fmtCompactUSD(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmtUSD(n);
}

export function shortenAddr(addr: string, n = 4): string {
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

// ---------- ticker (counts up to a target value on mount) ----------

function useTicker(target: number, durationMs = 900): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target === 0) {
      setVal(0);
      return;
    }
    const start = performance.now();
    let raf: number;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(target * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}

export function TickerNum({
  to,
  decimals = 2,
  suffix = '',
  prefix = '',
}: {
  to: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}) {
  const v = useTicker(to);
  return <>{prefix}{v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

export function TickerUSD({ to, decimals = 0 }: { to: number; decimals?: number }) {
  return <TickerNum to={to} decimals={decimals} prefix="$" />;
}

// ---------- AnimBar (fills to target % on mount) ----------

export function AnimBar({
  pct,
  height = 6,
  fill = color.accent,
  track = 'rgba(255,255,255,0.05)',
  delay = 0,
  duration = 1100,
}: {
  pct: number;
  height?: number;
  fill?: string;
  track?: string;
  delay?: number;
  duration?: number;
}) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(Math.max(0, Math.min(100, pct))), delay);
    return () => clearTimeout(t);
  }, [pct, delay]);
  return (
    <div style={{ height, background: track, borderRadius: radius.pill, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${w}%`,
          background: fill,
          borderRadius: radius.pill,
          transition: `width ${duration}ms ${motion.ease}`,
        }}
      />
    </div>
  );
}

// ---------- PageFade & StaggerItem ----------

export function PageFade({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      style={{
        ...style,
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(8px)',
        transition: `opacity ${motion.slow} ease-out, transform ${motion.slow} ${motion.ease}`,
      }}
    >
      {children}
    </div>
  );
}

export function StaggerItem({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(6px)',
        transition: `opacity 500ms ease-out, transform 500ms ${motion.ease}`,
      }}
    >
      {children}
    </div>
  );
}

export function Stagger({
  children,
  base = 100,
  step = 80,
}: {
  children: ReactNode;
  base?: number;
  step?: number;
}) {
  return (
    <>
      {Children.map(children, (child, i) => (
        <StaggerItem delay={base + i * step}>{child}</StaggerItem>
      ))}
    </>
  );
}

// ---------- LiveDot ----------

export function LiveDot({ size = 6, c = color.green }: { size?: number; c?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: radius.pill,
        background: c,
        boxShadow: `0 0 0 3px ${c}22`,
      }}
    />
  );
}

// ---------- MCard ----------

type DivProps = HTMLAttributes<HTMLDivElement>;

export function MCard({
  children,
  style,
  padding = 20,
  ...rest
}: DivProps & { padding?: number }) {
  return (
    <div
      {...rest}
      style={{
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.xl,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------- MLabel (uppercase mono kicker) ----------

export function MLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 11.5,
        color: color.textDim,
        fontFamily: font.mono,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------- Button helpers (style objects) ----------

export const btnPrimary = (extra: CSSProperties = {}): CSSProperties => ({
  background: color.text,
  color: color.bg,
  border: 'none',
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: radius.md,
  cursor: 'pointer',
  fontFamily: font.display,
  letterSpacing: '-0.01em',
  ...extra,
});

export const btnGhost = (extra: CSSProperties = {}): CSSProperties => ({
  background: 'transparent',
  color: color.text,
  border: `1px solid ${color.borderHi}`,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: radius.md,
  cursor: 'pointer',
  fontFamily: font.display,
  ...extra,
});

export const btnAccent = (extra: CSSProperties = {}): CSSProperties => ({
  background: color.accent,
  color: color.bg,
  border: 'none',
  padding: '12px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: radius.md,
  cursor: 'pointer',
  fontFamily: font.display,
  letterSpacing: '-0.01em',
  ...extra,
});

export const btnDanger = (extra: CSSProperties = {}): CSSProperties => ({
  ...btnAccent(),
  background: color.red,
  ...extra,
});

// ---------- Coin glyph (circular badge) ----------

export function CoinBadge({
  glyph,
  bg,
  fg,
  size = 30,
}: {
  glyph: string;
  bg?: string;
  fg?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        background: bg ?? color.surfaceHi,
        color: fg ?? color.text,
        border: bg ? 'none' : `1px solid ${color.borderHi}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.5),
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  );
}

// ---------- BetaPill ----------

export function BetaPill() {
  return (
    <div
      style={{
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: radius.sm,
        background: color.accentDim,
        color: color.accent,
        fontFamily: font.mono,
        letterSpacing: '0.05em',
      }}
    >
      BETA
    </div>
  );
}

// ---------- Skeleton (loading placeholder) ----------

export function Skeleton({
  width,
  height = 12,
  radius: r = 4,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="xive-skeleton"
      style={{
        width: width ?? '100%',
        height,
        borderRadius: r,
        ...style,
      }}
    />
  );
}

export function SkeletonCircle({ size = 30 }: { size?: number }) {
  return (
    <div
      className="xive-skeleton"
      style={{ width: size, height: size, borderRadius: radius.pill, flexShrink: 0 }}
    />
  );
}

// ---------- Input (large mono numeric input matching the design) ----------

export function MonoInput({
  value,
  onChange,
  placeholder,
  fontSize = 36,
  c = color.text,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  fontSize?: number;
  c?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        flex: 1,
        fontFamily: font.mono,
        fontSize,
        fontWeight: 400,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: c,
        letterSpacing: '-0.02em',
        width: 0,
        minWidth: 0,
        padding: 0,
      }}
    />
  );
}
