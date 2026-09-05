/**
 * The simulated business: customers, calendar, prices and gateway fee model.
 *
 * Money flows forward - invoice, then the payment that settles it, then the
 * bank credit that carries it. Deriving in that order means the data is
 * coherent by construction: fees match the method, dates are ordered, and
 * balances tie.
 */

import { applyRateBps } from '../lib/money';
import { customerId } from '../lib/ids';
import { pick, randomInt, weightedPick, type Rng } from '../lib/rng';
import type { PaymentMethod } from '../domain/types';

export const PERIOD_START = '2026-03-01';
export const PERIOD_DAYS = 31;
export const IST_OFFSET = '+05:30';

const COMPANY_STEMS = [
  'Acme Trading', 'Vermillion Textiles', 'Sundara Foods', 'Nilgiri Coffee Works',
  'Kaveri Logistics', 'Bharat Instruments', 'Meridian Papers', 'Sahyadri Organics',
  'Trilok Electricals', 'Anantha Ceramics', 'Pushpa Garments', 'Konkan Seafoods',
  'Deccan Hardware', 'Indus Polymers', 'Marigold Interiors', 'Rasika Publishing',
  'Chola Metals', 'Vindhya Chemicals', 'Suvarna Jewellers', 'Nalanda Books',
  'Gokul Dairy', 'Tapti Engineering', 'Vaishali Prints', 'Mandara Spices',
  'Aravalli Stone', 'Kalinga Furniture', 'Neelkanth Pipes', 'Saraswati Optics',
  'Hampi Handlooms', 'Malabar Rubber', 'Zephyr Packaging', 'Ratnagiri Exports',
];
const COMPANY_SUFFIXES = ['Pvt Ltd', 'LLP', 'and Sons', 'Enterprises', 'Industries', 'and Co'];

export interface Customer {
  customer_id: string;
  customer_name: string;
  preferred_method: PaymentMethod;
}

export function buildCustomers(rng: Rng, count: number): Customer[] {
  const out: Customer[] = [];
  for (let i = 1; i <= count; i++) {
    const stem = COMPANY_STEMS[(i - 1) % COMPANY_STEMS.length] as string;
    const suffix = pick(rng, COMPANY_SUFFIXES);
    const disambiguator = i > COMPANY_STEMS.length ? ' ' + Math.ceil(i / COMPANY_STEMS.length) : '';
    out.push({
      customer_id: customerId(i),
      customer_name: stem + disambiguator + ' ' + suffix,
      preferred_method: weightedPick(rng, [
        ['upi', 44],
        ['card', 26],
        ['netbanking', 18],
        ['wallet', 7],
        ['emi', 5],
      ] as const),
    });
  }
  return out;
}

// ---------- Calendar ----------

/** Add days to an ISO date string. Pure UTC arithmetic, no host timezone. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return (
    dt.getUTCFullYear() +
    '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getUTCDate()).padStart(2, '0')
  );
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** ISO datetime pinned to Asia/Kolkata. Never depends on the host clock. */
export function atTime(isoDate: string, hour: number, minute: number, second = 0): string {
  return (
    isoDate +
    'T' +
    String(hour).padStart(2, '0') +
    ':' +
    String(minute).padStart(2, '0') +
    ':' +
    String(second).padStart(2, '0') +
    IST_OFFSET
  );
}

export function randomTimeOn(rng: Rng, isoDate: string): string {
  return atTime(isoDate, randomInt(rng, 8, 21), randomInt(rng, 0, 59), randomInt(rng, 0, 59));
}

export function issueDateFor(rng: Rng): string {
  return addDays(PERIOD_START, randomInt(rng, 0, PERIOD_DAYS - 8));
}

// ---------- Prices ----------

const GST_ON_FEE_BPS = 1800;

/** Invoice gross in paise. Long tail: mostly small, occasionally large. */
export function invoiceGrossPaise(rng: Rng): number {
  const bucket = weightedPick(rng, [
    ['small', 52],
    ['medium', 33],
    ['large', 12],
    ['xlarge', 3],
  ] as const);
  switch (bucket) {
    case 'small':
      return randomInt(rng, 45_000, 500_000);
    case 'medium':
      return randomInt(rng, 500_000, 3_000_000);
    case 'large':
      return randomInt(rng, 3_000_000, 15_000_000);
    case 'xlarge':
      return randomInt(rng, 15_000_000, 60_000_000);
  }
}

/** Standard fee rate in basis points, by method. */
export function standardFeeBps(method: PaymentMethod): number {
  switch (method) {
    case 'upi':
      return 20;
    case 'card':
      return 200;
    case 'netbanking':
      return 180;
    case 'wallet':
      return 220;
    case 'emi':
      return 250;
  }
}

/** The band the engine treats as plausible for this method (BUILD_SPEC stage 2). */
export function feeBandBps(method: PaymentMethod): { min: number; max: number } {
  return method === 'upi' ? { min: 0, max: 40 } : { min: 160, max: 240 };
}

export interface FeeBreakdown {
  fee_paise: number;
  tax_on_fee_paise: number;
  net_paise: number;
  applied_bps: number;
}

export function computeFees(amountPaise: number, method: PaymentMethod, bpsOverride?: number): FeeBreakdown {
  const bps = bpsOverride ?? standardFeeBps(method);
  const fee = applyRateBps(amountPaise, bps);
  const tax = applyRateBps(fee, GST_ON_FEE_BPS);
  return { fee_paise: fee, tax_on_fee_paise: tax, net_paise: amountPaise - fee - tax, applied_bps: bps };
}

/** Tax component of an invoice (18% GST inclusive of the gross). */
export function invoiceTaxPaise(grossPaise: number): number {
  return Math.round((grossPaise * 18) / 118);
}
