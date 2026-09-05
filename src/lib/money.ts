/**
 * Money. Every amount in this system is an integer count of paise.
 *
 * Floating point cannot represent most decimal fractions, so a reconciliation
 * engine built on floats cannot prove that a set of payments sums exactly to a
 * bank credit. Integers can. Rupee formatting happens at the presentation
 * layer and nowhere else.
 *
 * See BUILD_SPEC P3.
 */

export class MoneyParseError extends Error {
  constructor(
    readonly input: string,
    readonly reason: string,
  ) {
    super(`Cannot parse "${input}" as a rupee amount: ${reason}`);
    this.name = 'MoneyParseError';
  }
}

/** Strip currency symbols, spaces and grouping separators. */
function stripDecoration(raw: string): { body: string; negative: boolean } {
  let s = raw.trim();
  let negative = false;

  // Accounting negatives: (500.00)
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  s = s.replace(/^(INR|Rs\.?|₹)\s*/i, '').trim();

  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  // Grouping separators. Indian exports use 1,00,000.00; western ones 100,000.00.
  // Both are unambiguous once the decimal point is the only remaining dot.
  s = s.replace(/,/g, '');

  return { body: s, negative };
}

/**
 * Parse a rupee decimal string into integer paise.
 *
 * Deliberately never calls parseFloat/Number on the whole string: the integer
 * and fractional halves are parsed separately so no binary rounding can occur.
 *   parseFloat("8.165") * 100 === 816.4999999999999  -> would floor to 816
 *
 * Throws MoneyParseError on anything not a well-formed amount. Callers must
 * count the failure rather than coercing to zero (BUILD_SPEC section 9).
 */
export function parseRupees(input: string): number {
  if (typeof input !== 'string') {
    throw new MoneyParseError(String(input), 'not a string');
  }

  const { body, negative } = stripDecoration(input);

  if (body.length === 0) throw new MoneyParseError(input, 'empty');
  if (!/^\d*\.?\d*$/.test(body)) throw new MoneyParseError(input, 'contains non-numeric characters');

  const dotCount = (body.match(/\./g) ?? []).length;
  if (dotCount > 1) throw new MoneyParseError(input, 'more than one decimal point');

  const [wholePart = '', fracPartRaw = ''] = body.split('.');
  if (wholePart.length === 0 && fracPartRaw.length === 0) {
    throw new MoneyParseError(input, 'no digits');
  }
  if (fracPartRaw.length > 2) {
    throw new MoneyParseError(input, `${fracPartRaw.length} decimal places, expected at most 2`);
  }

  const whole = wholePart.length > 0 ? Number(wholePart) : 0;
  const frac = fracPartRaw.length > 0 ? Number(fracPartRaw.padEnd(2, '0')) : 0;

  if (!Number.isSafeInteger(whole)) throw new MoneyParseError(input, 'amount too large');

  const paise = whole * 100 + frac;
  if (!Number.isSafeInteger(paise)) throw new MoneyParseError(input, 'amount too large');

  return negative ? -paise : paise;
}

/** Parse, or return null instead of throwing. For defensive ingest paths. */
export function tryParseRupees(input: string): number | null {
  try {
    return parseRupees(input);
  } catch {
    return null;
  }
}

/** Integer paise -> plain rupee decimal string, no separators. CSV/JSON safe. */
export function toRupeeString(paise: number): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

const INDIAN_GROUPING = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/**
 * Integer paise -> grouped rupee string using Indian (lakh/crore) grouping.
 *   10000000 -> "1,00,000.00"   not "100,000.00"
 */
export function formatPaise(paise: number): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = INDIAN_GROUPING.format(whole).replace(/\.00$/, '');
  return `${sign}${grouped}.${String(frac).padStart(2, '0')}`;
}

/** Integer paise -> display string with the rupee sign. Presentation only. */
export function formatINR(paise: number): string {
  const body = formatPaise(paise);
  return body.startsWith('-') ? `-₹${body.slice(1)}` : `₹${body}`;
}

/** Signed variance, always carrying an explicit sign. For the exception queue. */
export function formatVariance(paise: number): string {
  if (paise === 0) return '₹0.00';
  const sign = paise > 0 ? '+' : '\u2212';
  return `${sign}₹${formatPaise(Math.abs(paise))}`;
}

export function sumPaise(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertPaise(v);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('paise sum exceeded safe integer range');
  return total;
}

export function absPaise(paise: number): number {
  assertPaise(paise);
  return Math.abs(paise);
}

/** Basis-point maths on paise, rounded half-up. Used for gateway fee modelling. */
export function applyRateBps(paise: number, bps: number): number {
  assertPaise(paise);
  if (!Number.isInteger(bps)) throw new RangeError('bps must be an integer');
  return Math.round((paise * bps) / 10_000);
}

/** Are two amounts equal within a paise tolerance? */
export function withinTolerance(a: number, b: number, tolerancePaise: number): boolean {
  assertPaise(a);
  assertPaise(b);
  return Math.abs(a - b) <= tolerancePaise;
}

export function assertPaise(value: number): asserts value is number {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Money must be an integer number of paise, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Paise value ${value} is outside the safe integer range`);
  }
}
