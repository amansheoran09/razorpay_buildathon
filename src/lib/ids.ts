/**
 * Identifier generation.
 *
 * Two kinds of ID exist in this system:
 *   1. Internal record IDs (LED-000001) - sequential, stable, used by ground
 *      truth to name a record. No randomness at all.
 *   2. Simulated third-party identifiers (pay_R7xK2mQ9dLa1) - these must look
 *      like real Razorpay identifiers, so they are random, but seeded.
 *
 * nanoid is not seedable by default. customAlphabet accepts a byte source, so
 * we feed it our own PRNG. A bare nanoid() import would silently break P6.
 */

import { customRandom } from 'nanoid';
import type { Rng } from './rng';

export type IdPrefix = 'LED' | 'GW' | 'BNK' | 'MCH' | 'CND' | 'TRU' | 'DEC';

/** Sequential zero-padded counter, e.g. LED-000001. */
export function counter(prefix: IdPrefix, width = 6): () => string {
  let n = 0;
  return () => {
    n += 1;
    return formatId(prefix, n, width);
  };
}

export function formatId(prefix: IdPrefix, n: number, width = 6): string {
  return prefix + '-' + String(n).padStart(width, '0');
}

const RZP_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface RazorpayIdFactory {
  payment: () => string;
  order: () => string;
  settlement: () => string;
  refund: () => string;
}

/** Razorpay-shaped identifier factory bound to a seeded Rng. */
export function razorpayIds(rng: Rng): RazorpayIdFactory {
  const random = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(rng() * 256);
    return bytes;
  };
  const nano = customRandom(RZP_ALPHABET, 14, random);
  const make = (prefix: string) => (): string => prefix + '_' + nano();
  return {
    payment: make('pay'),
    order: make('order'),
    settlement: make('setl'),
    refund: make('rfnd'),
  };
}

/** Invoice numbers look like INV-2026-04471. */
export function invoiceNumber(year: number, seq: number): string {
  return 'INV-' + year + '-' + String(seq).padStart(5, '0');
}

export function customerId(n: number): string {
  return 'CUST-' + String(n).padStart(4, '0');
}

/** Bank internal sequence numbers, used when narration loses the real reference. */
export function bankSequence(rng: Rng): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += Math.floor(rng() * 10);
  return s;
}

/** Run IDs look like RUN-20260824-01. */
export function runId(date: Date, ordinal: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return 'RUN-' + y + m + d + '-' + String(ordinal).padStart(2, '0');
}
