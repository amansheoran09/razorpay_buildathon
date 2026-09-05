import { formatINR, formatPaise, formatVariance } from '@/lib/money';

/** Amounts are always monospace, tabular and right-aligned. */
export function Money({ paise, sign = false }: { paise: number; sign?: boolean }) {
  return <span className="num">{sign ? formatVariance(paise) : formatINR(paise)}</span>;
}

export function Variance({ paise }: { paise: number }) {
  if (paise === 0) return <span className="num" style={{ color: 'var(--muted)' }}>0.00</span>;
  return (
    <span className="num" style={{ color: 'var(--amber)' }}>
      {formatVariance(paise)}
    </span>
  );
}

export function Plain({ paise }: { paise: number }) {
  return <span className="num">{formatPaise(paise)}</span>;
}

export function Pct({ value, digits = 1 }: { value: number; digits?: number }) {
  return <span className="num">{(value * 100).toFixed(digits)}%</span>;
}

export function Num({ value, digits = 0 }: { value: number; digits?: number }) {
  return <span className="num">{value.toFixed(digits)}</span>;
}
