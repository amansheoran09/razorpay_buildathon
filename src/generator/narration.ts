/**
 * Bank narration generation (BUILD_SPEC section 8).
 *
 * Narrations are the primary source of difficulty in real reconciliation. They
 * are built from templates and then corrupted, because that is what an actual
 * bank export looks like after it has passed through a core banking system
 * with a fixed-width narration field.
 */

import { bankSequence } from '../lib/ids';
import { chance, pick, randomInt, type Rng } from '../lib/rng';

export const BANK_CODES = ['HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'YESB', 'IDFB', 'PUNB'] as const;
export const GATEWAY_CODES = ['RAZORPAY', 'RZPY', 'RZP', 'RAZORPAYSOFT'] as const;
export const VPA_HANDLES = ['okhdfcbank', 'okicici', 'oksbi', 'okaxis', 'ybl', 'paytm'] as const;

export type NarrationTemplate =
  | 'neft'
  | 'upi'
  | 'imps'
  | 'rtgs'
  | 'gateway_star'
  | 'mobile_transfer';

export const NARRATION_TEMPLATES: NarrationTemplate[] = [
  'neft',
  'upi',
  'imps',
  'rtgs',
  'gateway_star',
  'mobile_transfer',
];

export interface NarrationInput {
  reference: string;
  settlementId: string | null;
  customerName: string;
  rng: Rng;
}

/** Short display form of a settlement id, as banks tend to render it. */
export function settlementShort(settlementId: string | null): string {
  if (!settlementId) return 'BATCH';
  return settlementId.replace(/^setl_/, '').slice(0, 8).toUpperCase();
}

function vpaFor(name: string, rng: Rng): string {
  const slug = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10) || 'customer';
  return slug + '@' + pick(rng, VPA_HANDLES);
}

function shortName(name: string, max = 12): string {
  return name.toUpperCase().replace(/[^A-Z ]/g, '').trim().slice(0, max);
}

export function buildNarration(template: NarrationTemplate, input: NarrationInput): string {
  const { reference, settlementId, customerName, rng } = input;
  const bank = pick(rng, BANK_CODES);
  switch (template) {
    case 'neft':
      return 'NEFT/' + bank + '/' + reference + '/' + shortName(customerName);
    case 'upi':
      return 'UPI/' + vpaFor(customerName, rng) + '/' + reference + '/PAYMENT';
    case 'imps':
      return 'IMPS/' + reference + '/' + shortName(customerName);
    case 'rtgs':
      return 'RTGS-' + bank + '-' + reference;
    case 'gateway_star':
      return pick(rng, GATEWAY_CODES) + '*' + settlementShort(settlementId);
    case 'mobile_transfer':
      return 'MB/TRF/' + reference;
  }
}

// ---------- Corruptions ----------

export type Corruption =
  | 'truncate'
  | 'settlement_instead_of_invoice'
  | 'strip_separators'
  | 'transpose_digits'
  | 'batch_suffix'
  | 'bank_sequence'
  | 'no_reference';

export const CORRUPTIONS: Corruption[] = [
  'truncate',
  'settlement_instead_of_invoice',
  'strip_separators',
  'transpose_digits',
  'batch_suffix',
  'bank_sequence',
  'no_reference',
];

/** Swap two adjacent digits somewhere in the string. */
function transposeDigits(text: string, rng: Rng): string {
  const positions: number[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (/\d/.test(text[i] as string) && /\d/.test(text[i + 1] as string)) positions.push(i);
  }
  if (positions.length === 0) return text;
  const at = pick(rng, positions);
  return text.slice(0, at) + text[at + 1] + text[at] + text.slice(at + 2);
}

export interface CorruptionResult {
  narration: string;
  applied: Corruption[];
  referenceSurvives: boolean;
}

export function corrupt(
  narration: string,
  reference: string,
  settlementId: string | null,
  which: Corruption,
  rng: Rng,
): CorruptionResult {
  switch (which) {
    case 'truncate': {
      const width = chance(rng, 0.5) ? 24 : 32;
      const cut = narration.slice(0, width);
      return { narration: cut, applied: [which], referenceSurvives: cut.includes(reference) };
    }
    case 'settlement_instead_of_invoice': {
      const replacement = settlementId ?? 'SETL' + bankSequence(rng).slice(0, 6);
      return {
        narration: narration.replace(reference, replacement),
        applied: [which],
        referenceSurvives: false,
      };
    }
    case 'strip_separators': {
      const stripped = narration.toUpperCase().replace(/[\/\-_.*\s]/g, '');
      return {
        narration: stripped,
        applied: [which],
        referenceSurvives: stripped.includes(reference.toUpperCase().replace(/[^A-Z0-9]/g, '')),
      };
    }
    case 'transpose_digits':
      return { narration: transposeDigits(narration, rng), applied: [which], referenceSurvives: false };
    case 'batch_suffix': {
      const suffix = pick(rng, ['-B2', '/PART1', '-B1', '/P2', '-BATCH3']);
      return { narration: narration + suffix, applied: [which], referenceSurvives: true };
    }
    case 'bank_sequence':
      return {
        narration: narration.replace(reference, bankSequence(rng)),
        applied: [which],
        referenceSurvives: false,
      };
    case 'no_reference':
      return { narration: pick(rng, ['NEFT CR', 'BY TRANSFER', 'CR-TRF', 'NEFT CR ']), applied: [which], referenceSurvives: false };
  }
}

/** Pick a corruption weighted so the destructive ones stay rarer. */
export function pickCorruption(rng: Rng, allowDestructive: boolean): Corruption {
  const pool: Corruption[] = allowDestructive
    ? ['truncate', 'settlement_instead_of_invoice', 'strip_separators', 'transpose_digits', 'batch_suffix', 'bank_sequence', 'no_reference']
    : ['truncate', 'strip_separators', 'batch_suffix', 'transpose_digits'];
  return pick(rng, pool);
}

/** Debit narration for a chargeback reversal. */
export function chargebackNarration(reference: string, rng: Rng): string {
  const template = pick(rng, ['CHARGEBACK/', 'CB-DEBIT/', 'DISPUTE DR/', 'RETURN/']);
  return template + reference + '/' + String(randomInt(rng, 100000, 999999));
}
