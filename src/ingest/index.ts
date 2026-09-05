/**
 * Ingest: messy CSV in, typed domain objects out (BUILD_SPEC section 9).
 *
 * Defensive by design - the generator deliberately produces malformed rows.
 * Nothing is silently coerced: a value that will not parse becomes a counted
 * IngestWarning and the row is dropped, never zeroed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
import { formatId } from '../lib/ids';
import { tryParseRupees } from '../lib/money';
import type {
  BankRecord,
  DatasetName,
  GatewayRecord,
  GroundTruth,
  IngestWarning,
  LedgerRecord,
  PaymentMethod,
} from '../domain/types';
import { extractReferences, normalizeRef, refKeys } from './normalize';

export interface NormalizedBank extends BankRecord {
  extracted_references: string[];
  reference_keys: { full: string; last6: string }[];
}

export interface IngestResult {
  ledger: LedgerRecord[];
  gateway: GatewayRecord[];
  bank: NormalizedBank[];
  warnings: IngestWarning[];
  duplicates: { source: string; record_ids: string[] }[];
  /**
   * Share of bank lines from which at least one reference token could be
   * extracted, measured on this run's own input.
   *
   * The engine uses it to discount negative conclusions. On legible data, "no
   * invoice matched this credit" is real evidence. On data where four in ten
   * narrations are unreadable, the same failed lookup means almost nothing, and
   * stating high confidence in it is how a system ends up saying 55% and being
   * right 1% of the time. This is measured, not configured, so it adapts to any
   * input without being tuned to a known dataset.
   */
  referenceLegibility: number;
}

function parseCsv(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return result.data;
}

export function ingestFromText(files: { ledger: string; gateway: string; bank: string }): IngestResult {
  const warnings: IngestWarning[] = [];
  const ledger = parseLedger(parseCsv(files.ledger), warnings);
  const gateway = parseGateway(parseCsv(files.gateway), warnings);
  const bank = parseBank(parseCsv(files.bank), warnings);
  // A token is only legible if it actually resolves to something we hold. A
  // bank-internal sequence number is a token and tells us nothing, so counting
  // it as legible overstated how much a failed lookup was worth.
  const known = new Set<string>();
  for (const l of ledger) known.add(normalizeRef(l.invoice_no));
  for (const g of gateway) {
    if (g.settlement_id) known.add(normalizeRef(g.settlement_id));
    if (g.order_id) known.add(normalizeRef(g.order_id));
    if (g.payment_id) known.add(normalizeRef(g.payment_id));
  }
  const resolves = (b: NormalizedBank): boolean =>
    b.reference_keys.some((key) => {
      if (known.has(key.full)) return true;
      for (const candidate of known) {
        if (candidate.includes(key.full) || key.full.includes(candidate)) return true;
      }
      return false;
    });
  const legible = bank.filter(resolves).length;
  return {
    ledger,
    gateway,
    bank,
    warnings,
    duplicates: findDuplicates(ledger, gateway, bank),
    referenceLegibility: bank.length === 0 ? 1 : legible / bank.length,
  };
}

export function ingestDataset(dataset: DatasetName, root = process.cwd()): IngestResult & { groundTruth: GroundTruth } {
  const dir = join(root, 'data', 'generated', dataset);
  const read = (name: string): string => readFileSync(join(dir, name), 'utf8');
  const result = ingestFromText({
    ledger: read('ledger.csv'),
    gateway: read('gateway.csv'),
    bank: read('bank.csv'),
  });
  const groundTruth = JSON.parse(read('ground_truth.json')) as GroundTruth;
  return { ...result, groundTruth };
}

// ---------- Per-source parsers ----------

function parseLedger(rows: Record<string, string>[], warnings: IngestWarning[]): LedgerRecord[] {
  const out: LedgerRecord[] = [];
  rows.forEach((row, i) => {
    const gross = tryParseRupees(row.gross_amount ?? '');
    const tax = tryParseRupees(row.tax_amount ?? '');
    if (gross === null) {
      warnings.push({ source: 'ledger', row_number: i + 2, field: 'gross_amount', raw_value: row.gross_amount ?? '', reason: 'unparseable amount' });
      return;
    }
    if (tax === null && (row.tax_amount ?? '').trim() !== '') {
      warnings.push({ source: 'ledger', row_number: i + 2, field: 'tax_amount', raw_value: row.tax_amount ?? '', reason: 'unparseable amount, defaulted to zero' });
    }
    out.push({
      record_id: formatId('LED', out.length + 1),
      source: 'ledger',
      invoice_no: (row.invoice_no ?? '').trim(),
      customer_id: (row.customer_id ?? '').trim(),
      customer_name: (row.customer_name ?? '').trim(),
      issue_date: (row.issue_date ?? '').trim(),
      due_date: (row.due_date ?? '').trim(),
      gross_amount_paise: gross,
      tax_amount_paise: tax ?? 0,
      currency: 'INR',
      status: (row.status ?? 'open') as LedgerRecord['status'],
      expected_reference: (row.reference ?? '').trim() || null,
      raw_row: row,
    });
  });
  return out;
}

function parseGateway(rows: Record<string, string>[], warnings: IngestWarning[]): GatewayRecord[] {
  const out: GatewayRecord[] = [];
  rows.forEach((row, i) => {
    const amount = tryParseRupees(row.amount ?? '');
    const net = tryParseRupees(row.net ?? '');
    if (amount === null || net === null) {
      warnings.push({ source: 'gateway', row_number: i + 2, field: amount === null ? 'amount' : 'net', raw_value: (amount === null ? row.amount : row.net) ?? '', reason: 'unparseable amount' });
      return;
    }
    for (const field of ['fee', 'tax_on_fee'] as const) {
      const raw = (row[field] ?? '').trim();
      if (raw !== '' && tryParseRupees(raw) === null) {
        warnings.push({ source: 'gateway', row_number: i + 2, field, raw_value: raw, reason: 'unparseable amount, defaulted to zero' });
      }
    }
    out.push({
      record_id: formatId('GW', out.length + 1),
      source: 'gateway',
      payment_id: (row.payment_id ?? '').trim(),
      order_id: (row.order_id ?? '').trim() || null,
      receipt: (row.receipt ?? '').trim() || null,
      captured_at: (row.captured_at ?? '').trim(),
      amount_paise: amount,
      fee_paise: tryParseRupees(row.fee ?? '') ?? 0,
      tax_on_fee_paise: tryParseRupees(row.tax_on_fee ?? '') ?? 0,
      net_paise: net,
      method: ((row.method ?? 'upi').trim() as PaymentMethod),
      status: ((row.status ?? 'captured').trim() as GatewayRecord['status']),
      refund_paise: tryParseRupees(row.refund ?? '') ?? 0,
      settlement_id: (row.settlement_id ?? '').trim() || null,
      settled_at: (row.settled_at ?? '').trim() || null,
      raw_row: row,
    });
  });
  return out;
}

function parseBank(rows: Record<string, string>[], warnings: IngestWarning[]): NormalizedBank[] {
  const out: NormalizedBank[] = [];
  rows.forEach((row, i) => {
    const amount = tryParseRupees(row.amount ?? '');
    const balance = tryParseRupees(row.balance ?? '');
    if (amount === null) {
      warnings.push({ source: 'bank', row_number: i + 2, field: 'amount', raw_value: row.amount ?? '', reason: 'unparseable amount' });
      return;
    }
    if (balance === null && (row.balance ?? '').trim() !== '') {
      warnings.push({ source: 'bank', row_number: i + 2, field: 'balance', raw_value: row.balance ?? '', reason: 'unparseable running balance, defaulted to zero' });
    }
    const narration = (row.narration ?? '').trim();
    const extracted = extractReferences(narration);
    const explicit = (row.reference_no ?? '').trim();
    const references = explicit && !extracted.includes(explicit) ? [explicit, ...extracted] : extracted;

    out.push({
      record_id: formatId('BNK', out.length + 1),
      source: 'bank',
      value_date: (row.value_date ?? '').trim(),
      posted_at: (row.posted_at ?? '').trim(),
      narration,
      reference_no: explicit || null,
      direction: (row.type ?? 'CR').trim().toUpperCase() === 'DR' ? 'debit' : 'credit',
      amount_paise: Math.abs(amount),
      balance_paise: balance ?? 0,
      raw_row: row,
      extracted_references: references,
      reference_keys: references.map(refKeys),
    });
  });
  return out;
}

/** Exact duplicate rows within a source are flagged, never silently deduped. */
function findDuplicates(
  ledger: LedgerRecord[],
  gateway: GatewayRecord[],
  bank: NormalizedBank[],
): { source: string; record_ids: string[] }[] {
  const out: { source: string; record_ids: string[] }[] = [];
  const scan = (source: string, items: { record_id: string }[], key: (item: never) => string): void => {
    const groups = new Map<string, string[]>();
    for (const item of items) {
      const k = key(item as never);
      const list = groups.get(k);
      if (list) list.push(item.record_id);
      else groups.set(k, [item.record_id]);
    }
    for (const ids of groups.values()) if (ids.length > 1) out.push({ source, record_ids: ids });
  };

  scan('ledger', ledger, (r: LedgerRecord) => r.invoice_no + '|' + r.gross_amount_paise);
  scan('gateway', gateway, (r: GatewayRecord) => r.payment_id + '|' + r.amount_paise + '|' + r.captured_at);
  scan('bank', bank, (r: NormalizedBank) => r.posted_at + '|' + r.amount_paise + '|' + normalizeRef(r.narration));
  return out;
}
