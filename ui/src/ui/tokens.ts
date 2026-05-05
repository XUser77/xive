// Direction A — Minimal & calm. Source of truth for colors, fonts, motion.
// Mirrors the design handoff README.

export const color = {
  bg: '#0b0d10',
  surface: '#13161b',
  surfaceHi: '#181c22',
  border: 'rgba(255,255,255,0.06)',
  borderHi: 'rgba(255,255,255,0.10)',

  text: '#e9ecef',
  textDim: '#8a9099',
  textMute: '#5b6168',

  accent: '#7c9bff',
  accentDim: 'rgba(124, 155, 255, 0.12)',

  green: '#5fc28a',
  amber: '#e6b450',
  red: '#ec6f6f',

  // brand glyph backgrounds
  ethTint: 'rgba(99, 102, 241, 0.12)',
  ethFg: '#7c9bff',
  btcTint: 'rgba(247, 147, 26, 0.14)',
  btcFg: '#f7931a',
  solTint: 'rgba(153, 69, 255, 0.14)',
  solFg: '#c084fc',
} as const;

export const font = {
  display: "'Geist', system-ui, sans-serif",
  mono: "'Geist Mono', 'JetBrains Mono', monospace",
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  xxl: 12,
  pill: 99,
} as const;

export const motion = {
  fast: '150ms',
  med: '160ms',
  slow: '400ms',
  ticker: '900ms',
  bar: '600ms',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// Brand metadata for known collateral mints.
export const COLLATERAL_BRAND: Record<string, { glyph: string; tint: string; fg: string }> = {
  WETH: { glyph: 'Ξ', tint: color.ethTint, fg: color.ethFg },
  WBTC: { glyph: '₿', tint: color.btcTint, fg: color.btcFg },
  ETH: { glyph: 'Ξ', tint: color.ethTint, fg: color.ethFg },
  BTC: { glyph: '₿', tint: color.btcTint, fg: color.btcFg },
  SOL: { glyph: '◎', tint: color.solTint, fg: color.solFg },
};

export function brandFor(symbol: string) {
  return COLLATERAL_BRAND[symbol] ?? {
    glyph: symbol.slice(0, 1).toUpperCase(),
    tint: 'rgba(255,255,255,0.06)',
    fg: color.text,
  };
}
