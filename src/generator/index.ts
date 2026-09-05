/**
 * Synthetic data generator (BUILD_SPEC section 8).
 *
 * Emits three CSVs plus the ground truth that names which records belong
 * together. The CSVs carry no record IDs - a real export would not - so record
 * IDs are positional, assigned by the ingest layer in file order. That means
 * bank IDs have to be assigned after the statement is sorted into date order,
 * and ground truth remapped accordingly.
 */

import { chance, pick, streamFor, type Rng } from '../lib/rng';
import { toRupeeString } from '../lib/money';
import { formatId } from '../lib/ids';
import type { DatasetName, GroundTruth } from '../domain/types';
import { allocateScenarios, profileFor, type ScenarioName } from './profiles';
import { createContext, type GenContext } from './context';
import { clean, feeVariance, narrationNoise, timingLag } from './scenarios/basic';
import { mergedPayment, refundOffset, splitPayment } from './scenarios/structural';
import { chargeback, duplicateRecord, missingInBank, missingInGateway } from './scenarios/gaps';

const DISPATCH: Record<ScenarioName, (ctx: GenContext) => void> = {
  clean,
  timing_lag: timingLag,
  merged_payment: mergedPayment,
  split_payment: splitPayment,
  fee_variance: feeVariance,
  refund_offset: refundOffset,
  narration_noise: narrationNoise,
  missing_in_bank: missingInBank,
  missing_in_gateway: missingInGateway,
  duplicate: duplicateRecord,
  chargeback,
};

const OPENING_BALANCE_PAISE = 250_000_000;

export interface GeneratedDataset {
  dataset: DatasetName;
  seed: number;
  ledgerCsv: string;
  gatewayCsv: string;
  bankCsv: string;
  groundTruth: GroundTruth;
  counts: { ledger: number; gateway: number; bank: number; groups: number };
  scenarioCounts: Record<string, number>;
}

export function generate(options: {
  dataset: DatasetName;
  seed: number;
  count: number;
}): GeneratedDataset {
  const { dataset, seed, count } = options;
  const profile = profileFor(dataset);
  const customerCount = Math.max(24, Math.round(count / 6));
  const ctx = createContext(seed, profile, customerCount);

  const assignments = allocateScenarios(streamFor(seed, 'allocation'), count, profile);
  const scenarioCounts: Record<string, number> = {};
  for (const name of assignments) {
    scenarioCounts[name] = (scenarioCounts[name] ?? 0) + 1;
    DISPATCH[name](ctx);
  }

  finaliseBankStatement(ctx);

  const groundTruth: GroundTruth = {
    dataset,
    seed,
    generated_at: '2026-03-31T18:30:00+05:30',
    entries: ctx.truth,
  };

  return {
    dataset,
    seed,
    ledgerCsv: writeLedgerCsv(ctx),
    gatewayCsv: writeGatewayCsv(ctx),
    bankCsv: writeBankCsv(ctx),
    groundTruth,
    counts: {
      ledger: ctx.ledger.length,
      gateway: ctx.gateway.length,
      bank: ctx.bank.length,
      groups: ctx.truth.length,
    },
    scenarioCounts,
  };
}

/**
 * Sort the statement into posting order, reassign bank IDs positionally, remap
 * ground truth, then lay a consistent running balance over the top.
 */
function finaliseBankStatement(ctx: GenContext): void {
  const sorted = ctx.bank.slice().sort((a, b) => {
    if (a.posted_at !== b.posted_at) return a.posted_at < b.posted_at ? -1 : 1;
    return a.record_id < b.record_id ? -1 : 1;
  });

  const remap = new Map<string, string>();
  sorted.forEach((record, i) => {
    remap.set(record.record_id, formatId('BNK', i + 1));
  });

  let balance = OPENING_BALANCE_PAISE;
  sorted.forEach((record) => {
    record.record_id = remap.get(record.record_id) as string;
    balance += record.direction === 'credit' ? record.amount_paise : -record.amount_paise;
    record.balance_paise = balance;
    record.raw_row.balance = toRupeeString(balance);
  });

  ctx.bank.length = 0;
  ctx.bank.push(...sorted);

  for (const entry of ctx.truth) {
    entry.bank_ids = entry.bank_ids.map((id) => remap.get(id) ?? id);
  }
}

// ---------- CSV ----------

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function csv(header: string[], rows: string[][]): string {
  const lines = [header.join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

const LEDGER_HEADER = ['invoice_no', 'customer_id', 'customer_name', 'issue_date', 'due_date', 'gross_amount', 'tax_amount', 'currency', 'status', 'reference'];
const GATEWAY_HEADER = ['payment_id', 'order_id', 'receipt', 'captured_at', 'amount', 'fee', 'tax_on_fee', 'net', 'method', 'status', 'refund', 'settlement_id', 'settled_at'];
const BANK_HEADER = ['value_date', 'posted_at', 'narration', 'reference_no', 'type', 'amount', 'balance'];

/**
 * The shapes a real export actually produces when something upstream broke:
 * an empty cell, a placeholder, a letter that should have been a zero, an
 * amount with too many decimals, a stray currency symbol.
 */
const MALFORMED_CELLS = ['', 'N/A', '-', 'NULL', '1,0O0.00', '12.3456', 'INR ??', '#REF!'];

function damage(ctx: GenContext, rng: Rng, value: string): string {
  if (!chance(rng, ctx.profile.malformedCellRate)) return value;
  return pick(rng, MALFORMED_CELLS);
}

function writeLedgerCsv(ctx: GenContext): string {
  const rng = streamFor(ctx.seed, 'damage-ledger');
  return csv(
    LEDGER_HEADER,
    ctx.ledger.map((r) =>
      LEDGER_HEADER.map((h) => (h === 'tax_amount' ? damage(ctx, rng, r.raw_row[h] ?? '') : r.raw_row[h] ?? '')),
    ),
  );
}

function writeGatewayCsv(ctx: GenContext): string {
  const rng = streamFor(ctx.seed, 'damage-gateway');
  return csv(
    GATEWAY_HEADER,
    ctx.gateway.map((r) =>
      GATEWAY_HEADER.map((h) =>
        h === 'fee' || h === 'tax_on_fee' ? damage(ctx, rng, r.raw_row[h] ?? '') : r.raw_row[h] ?? '',
      ),
    ),
  );
}

function writeBankCsv(ctx: GenContext): string {
  const rng = streamFor(ctx.seed, 'damage-bank');
  return csv(
    BANK_HEADER,
    ctx.bank.map((r) => BANK_HEADER.map((h) => (h === 'balance' ? damage(ctx, rng, r.raw_row[h] ?? '') : r.raw_row[h] ?? ''))),
  );
}

export { DISPATCH };
