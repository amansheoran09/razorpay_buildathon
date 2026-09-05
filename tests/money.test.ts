import { describe, expect, it } from 'vitest';
import {
  MoneyParseError,
  applyRateBps,
  formatINR,
  formatPaise,
  formatVariance,
  parseRupees,
  sumPaise,
  toRupeeString,
  tryParseRupees,
  withinTolerance,
} from '../src/lib/money';

describe('parseRupees', () => {
  it('parses plain decimals exactly', () => {
    expect(parseRupees('1000.00')).toBe(100_000);
    expect(parseRupees('0.01')).toBe(1);
    expect(parseRupees('0.00')).toBe(0);
    expect(parseRupees('1000')).toBe(100_000);
    expect(parseRupees('1000.5')).toBe(100_050);
  });

  it('handles the values float multiplication gets wrong', () => {
    // parseFloat('8.165') * 100 === 816.4999999999999, which would floor to 816.
    // Three decimals are rejected outright rather than silently rounded.
    expect(() => parseRupees('8.165')).toThrow(MoneyParseError);
    expect(parseRupees('1.00')).toBe(100);
    expect(parseRupees('1.01')).toBe(101);
    expect(parseRupees('8.16')).toBe(816);
    expect(parseRupees('8.17')).toBe(817);
    expect(parseRupees('0.29')).toBe(29);
    expect(parseRupees('1234567.35')).toBe(123_456_735);
  });

  it('accepts Indian and western grouping', () => {
    expect(parseRupees('1,00,000.00')).toBe(10_000_000);
    expect(parseRupees('100,000.00')).toBe(10_000_000);
    expect(parseRupees('1,000.00')).toBe(100_000);
  });

  it('accepts currency decoration and whitespace', () => {
    expect(parseRupees('  1000.00  ')).toBe(100_000);
    expect(parseRupees('Rs. 1000.00')).toBe(100_000);
    expect(parseRupees('INR 1000.00')).toBe(100_000);
  });

  it('handles negatives in both notations', () => {
    expect(parseRupees('-500.00')).toBe(-50_000);
    expect(parseRupees('(500.00)')).toBe(-50_000);
  });

  it('rejects malformed input rather than coercing to zero', () => {
    for (const bad of ['', '   ', '-', 'N/A', 'abc', '10.00.00', '1000.555', '1,00,000.0000', 'null']) {
      expect(() => parseRupees(bad), bad).toThrow(MoneyParseError);
      expect(tryParseRupees(bad), bad).toBeNull();
    }
  });

  it('never returns a non-integer', () => {
    for (let i = 0; i < 10_000; i++) {
      const whole = i * 7919;
      const frac = i % 100;
      const s = whole + '.' + String(frac).padStart(2, '0');
      const paise = parseRupees(s);
      expect(Number.isSafeInteger(paise)).toBe(true);
      expect(paise).toBe(whole * 100 + frac);
    }
  });

  it('round-trips through toRupeeString for 10000 values', () => {
    for (let i = 0; i < 10_000; i++) {
      const paise = i * 1301 + (i % 97);
      expect(parseRupees(toRupeeString(paise))).toBe(paise);
    }
  });
});

describe('formatting', () => {
  it('uses Indian lakh grouping', () => {
    expect(formatPaise(10_000_000)).toBe('1,00,000.00');
    expect(formatPaise(4_732_000)).toBe('47,320.00');
    expect(formatPaise(1_000_000_000)).toBe('1,00,00,000.00');
    expect(formatPaise(0)).toBe('0.00');
    expect(formatPaise(1)).toBe('0.01');
  });

  it('renders the rupee sign outside the minus', () => {
    expect(formatINR(100_000)).toBe('\u20b91,000.00');
    expect(formatINR(-100_000)).toBe('-\u20b91,000.00');
  });

  it('renders signed variance', () => {
    expect(formatVariance(0)).toBe('\u20b90.00');
    expect(formatVariance(500)).toBe('+\u20b95.00');
    expect(formatVariance(-500)).toBe('\u2212\u20b95.00');
  });
});

describe('arithmetic', () => {
  it('rejects non-integer money', () => {
    expect(() => sumPaise([1.5])).toThrow(RangeError);
  });

  it('sums exactly over many values', () => {
    const values = Array.from({ length: 5000 }, (_, i) => i * 13 + 1);
    const expected = values.reduce((a, b) => a + b, 0);
    expect(sumPaise(values)).toBe(expected);
  });

  it('applies basis points as integers', () => {
    expect(applyRateBps(100_000, 200)).toBe(2000);
    expect(applyRateBps(100_000, 20)).toBe(200);
    expect(Number.isInteger(applyRateBps(123_457, 187))).toBe(true);
  });

  it('compares within tolerance', () => {
    expect(withinTolerance(100_000, 100_050, 100)).toBe(true);
    expect(withinTolerance(100_000, 100_500, 100)).toBe(false);
  });
});
