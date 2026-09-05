/**
 * Deterministic confidence scoring and evidence construction.
 *
 * Every relaxation the engine applies subtracts a fixed penalty and appends an
 * EvidenceItem written for a human reader. The evidence strings are what the
 * exception queue displays, so they name the specific values that decided it.
 */

import { formatINR, formatVariance } from '../lib/money';
import { daysApart, nameSimilarity, normalizeRef, referenceSimilarity } from '../ingest/normalize';
import type { EvidenceItem, GatewayRecord, LedgerRecord, PaymentMethod } from '../domain/types';
import type { NormalizedBank } from '../ingest';
import { feeBandBps } from '../generator/world';

export const BASE_TOLERANT_CONFIDENCE = 0.98;

export const PENALTY = {
  amount_within_tolerance: 0.05,
  date_window_widened: 0.05,
  reference_last6_only: 0.1,
  reference_transposition: 0.15,
  fee_within_band: 0.05,
  customer_fuzzy: 0.1,
} as const;

export function evidence(label: string, detail: string, weight: number, record_ids: string[]): EvidenceItem {
  return { label, detail, weight, record_ids };
}

export function exactReferenceEvidence(ledger: LedgerRecord, gateway: GatewayRecord): EvidenceItem {
  return evidence(
    'Reference match',
    'Gateway receipt ' + (gateway.receipt ?? '(none)') + ' equals invoice ' + ledger.invoice_no + '.',
    1,
    [ledger.record_id, gateway.record_id],
  );
}

export function amountEvidence(expected: number, observed: number, tolerancePaise: number, ids: string[]): EvidenceItem {
  const variance = expected - observed;
  if (variance === 0) {
    return evidence('Amount agreement', 'Both sides settle at ' + formatINR(observed) + ' exactly.', 1, ids);
  }
  const within = Math.abs(variance) <= tolerancePaise;
  return evidence(
    within ? 'Amount within tolerance' : 'Amount mismatch',
    'Expected ' + formatINR(expected) + ', observed ' + formatINR(observed) + '. Variance ' + formatVariance(variance) + '.',
    within ? 0.8 : 0.2,
    ids,
  );
}

export function dateEvidence(from: string, to: string, windowDays: number, ids: string[]): EvidenceItem {
  const gap = daysApart(from, to);
  return evidence(
    gap === 0 ? 'Same-day settlement' : 'Date gap',
    gap + ' day' + (gap === 1 ? '' : 's') + ' between ' + from.slice(0, 10) + ' and ' + to.slice(0, 10) + ', window is ' + windowDays + ' days.',
    gap <= windowDays ? 0.7 : 0.2,
    ids,
  );
}

export interface ReferenceMatch {
  matched: boolean;
  similarity: number;
  kind: 'exact' | 'contains' | 'last6' | 'transposed' | 'none';
  bankToken: string | null;
  penalty: number;
}

/**
 * Is `a` the same reference as `b` with characters transposed?
 *
 * Deliberately strict. Sequential invoice numbers differ by one or two digits,
 * so an edit-distance threshold alone treats every invoice as a near-match to
 * every other invoice - which silently produces wrong matches everywhere. A
 * genuine transposition is a permutation: same length, same characters, only
 * the order differs.
 */
export function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 6 || a === b) return false;
  const sortedA = a.split('').sort().join('');
  const sortedB = b.split('').sort().join('');
  if (sortedA !== sortedB) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
  return diffs === 2;
}

/** Best comparison between a bank line's tokens and a set of expected references. */
export function matchReference(bank: NormalizedBank, expected: string[]): ReferenceMatch {
  let best: ReferenceMatch = { matched: false, similarity: 0, kind: 'none', bankToken: null, penalty: 0 };
  for (const want of expected) {
    const target = normalizeRef(want);
    if (target.length < 4) continue;
    for (const key of bank.reference_keys) {
      let kind: ReferenceMatch['kind'] = 'none';
      let penalty = 0;
      if (key.full === target) {
        kind = 'exact';
      } else if (key.full.length >= 6 && (key.full.includes(target) || target.includes(key.full))) {
        kind = 'contains';
      } else if (key.last6.length === 6 && key.last6 === target.slice(-6)) {
        kind = 'last6';
        penalty = PENALTY.reference_last6_only;
      } else if (isTransposition(key.full, target)) {
        kind = 'transposed';
        penalty = PENALTY.reference_transposition;
      }
      if (kind === 'none') continue;
      const similarity = referenceSimilarity(key.full, target);
      if (similarity > best.similarity) {
        best = { matched: true, similarity, kind, bankToken: key.full, penalty };
      }
    }
  }
  return best;
}

export function referenceEvidence(match: ReferenceMatch, expected: string, ids: string[]): EvidenceItem {
  switch (match.kind) {
    case 'exact':
      return evidence('Reference match', 'Bank narration carries ' + expected + ' in full.', 1, ids);
    case 'contains':
      return evidence('Reference match', 'Bank token ' + match.bankToken + ' contains ' + expected + '.', 0.9, ids);
    case 'last6':
      return evidence(
        'Partial reference match',
        'Reference matched on last 6 characters only (' + match.bankToken + ' vs ' + expected + ').',
        0.6,
        ids,
      );
    case 'transposed':
      return evidence(
        'Reference near-match',
        'Bank token ' + match.bankToken + ' differs from ' + expected + ' by a small number of characters.',
        0.45,
        ids,
      );
    default:
      return evidence('No usable reference', 'Bank narration carries no token resembling ' + expected + '.', 0.05, ids);
  }
}

export function feeWithinBand(gateway: GatewayRecord): boolean {
  if (gateway.amount_paise === 0) return true;
  const bps = Math.round((gateway.fee_paise / gateway.amount_paise) * 10_000);
  const band = feeBandBps(gateway.method as PaymentMethod);
  return bps >= band.min && bps <= band.max;
}

export function feeEvidence(gateway: GatewayRecord): EvidenceItem {
  const bps = gateway.amount_paise === 0 ? 0 : Math.round((gateway.fee_paise / gateway.amount_paise) * 10_000);
  const band = feeBandBps(gateway.method as PaymentMethod);
  const within = bps >= band.min && bps <= band.max;
  return evidence(
    within ? 'Fee within expected band' : 'Fee outside expected band',
    'Fee is ' + (bps / 100).toFixed(2) + '% on ' + gateway.method + ', expected ' + (band.min / 100).toFixed(2) + '-' + (band.max / 100).toFixed(2) + '%.',
    within ? 0.6 : 0.15,
    [gateway.record_id],
  );
}

export function customerEvidence(ledger: LedgerRecord, narration: string): { ratio: number; item: EvidenceItem } {
  const ratio = nameSimilarity(ledger.customer_name, narration);
  return {
    ratio,
    item: evidence(
      ratio >= 0.85 ? 'Customer name match' : 'Customer name partial',
      'Narration tokens overlap ' + ledger.customer_name + ' at ' + ratio.toFixed(2) + '.',
      ratio,
      [ledger.record_id],
    ),
  };
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}
