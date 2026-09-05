/**
 * The signature element.
 *
 * Three tick marks on a short rule, one per source, in fixed order: ledger,
 * gateway, bank. A present record is a filled tick, a missing one is a hollow
 * outline. Variance is drawn as a horizontal offset of the rightmost tick,
 * proportional to variance as a share of the amount, clamped to 12px.
 *
 * A clean match reads as three evenly-spaced filled ticks. A missing bank
 * record reads as two filled and one hollow. An amount mismatch reads as three
 * filled with the last one visibly out of line. It takes about four rows to
 * learn, and after that a hundred exceptions can be scanned without reading.
 */

export interface StripProps {
  ledger: boolean;
  gateway: boolean;
  bank: boolean;
  variancePaise: number;
  amountPaise: number;
  size?: 'sm' | 'lg';
}

export function ReconciliationStrip({ ledger, gateway, bank, variancePaise, amountPaise, size = 'sm' }: StripProps) {
  const scale = size === 'lg' ? 1.6 : 1;
  const width = 46 * scale;
  const height = 14 * scale;
  const mid = height / 2;
  const positions = [4 * scale, width / 2, width - 4 * scale];

  const share = amountPaise === 0 ? 0 : variancePaise / amountPaise;
  const offset = Math.max(-12, Math.min(12, share * 40)) * scale;

  const tick = (x: number, filled: boolean, key: string) => (
    <circle
      key={key}
      cx={x}
      cy={mid}
      r={2.6 * scale}
      fill={filled ? 'var(--ink)' : 'none'}
      stroke={filled ? 'none' : 'var(--muted)'}
      strokeWidth={1}
    />
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={
        [ledger ? 'ledger' : 'no ledger', gateway ? 'gateway' : 'no gateway', bank ? 'bank' : 'no bank'].join(', ') +
        (variancePaise === 0 ? ', amounts agree' : ', amounts differ')
      }
      style={{ display: 'block', overflow: 'visible' }}
    >
      <line x1={positions[0]} y1={mid} x2={positions[2]} y2={mid} stroke="var(--rule)" strokeWidth={1} />
      {tick(positions[0] as number, ledger, 'l')}
      {tick(positions[1] as number, gateway, 'g')}
      {tick((positions[2] as number) + offset, bank, 'b')}
    </svg>
  );
}

export function stripPropsFor(match: {
  ledger_ids: string[];
  gateway_ids: string[];
  bank_ids: string[];
  variance_paise: number;
  reconciled_amount_paise: number;
}): StripProps {
  return {
    ledger: match.ledger_ids.length > 0,
    gateway: match.gateway_ids.length > 0,
    bank: match.bank_ids.length > 0,
    variancePaise: match.variance_paise,
    amountPaise: match.reconciled_amount_paise,
  };
}
