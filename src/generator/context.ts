/**
 * Generator context: the accumulating world plus the emit helpers.
 *
 * Ground truth is written at the moment a group is created, never inferred
 * afterwards. Reconstructing the answer key after the fact would mean solving
 * the same problem the engine is being tested on, and the test would inherit
 * every bug the engine has.
 */

import { counter, invoiceNumber, razorpayIds, type RazorpayIdFactory } from '../lib/ids';
import { streamFor, type Rng } from '../lib/rng';
import { toRupeeString } from '../lib/money';
import type {
  BankRecord,
  DatasetName,
  GatewayRecord,
  GroundTruthEntry,
  LedgerRecord,
} from '../domain/types';
import type { ExceptionType } from '../domain/taxonomy';
import { buildCustomers, type Customer } from './world';
import type { DatasetProfile } from './profiles';

export interface GenContext {
  rng: Rng;
  narrationRng: Rng;
  corruptionRng: Rng;
  seed: number;
  dataset: DatasetName;
  profile: DatasetProfile;
  customers: Customer[];
  rzp: RazorpayIdFactory;
  ledger: LedgerRecord[];
  gateway: GatewayRecord[];
  bank: BankRecord[];
  truth: GroundTruthEntry[];
  nextLedgerId: () => string;
  nextGatewayId: () => string;
  nextBankId: () => string;
  nextTruthId: () => string;
  nextInvoiceNo: () => string;
}

export function createContext(seed: number, profile: DatasetProfile, customerCount: number): GenContext {
  const rng = streamFor(seed, 'main');
  let invoiceSeq = 4000;
  return {
    rng,
    narrationRng: streamFor(seed, 'narration'),
    corruptionRng: streamFor(seed, 'corruption'),
    seed,
    dataset: profile.dataset,
    profile,
    customers: buildCustomers(streamFor(seed, 'customers'), customerCount),
    rzp: razorpayIds(streamFor(seed, 'rzp')),
    ledger: [],
    gateway: [],
    bank: [],
    truth: [],
    nextLedgerId: counter('LED'),
    nextGatewayId: counter('GW'),
    nextBankId: counter('BNK'),
    nextTruthId: counter('TRU'),
    nextInvoiceNo: () => invoiceNumber(2026, (invoiceSeq += 1)),
  };
}

// ---------- Emit helpers ----------

export function emitLedger(
  ctx: GenContext,
  fields: Omit<LedgerRecord, 'record_id' | 'source' | 'raw_row'>,
): LedgerRecord {
  const record: LedgerRecord = {
    record_id: ctx.nextLedgerId(),
    source: 'ledger',
    ...fields,
    raw_row: {
      invoice_no: fields.invoice_no,
      customer_id: fields.customer_id,
      customer_name: fields.customer_name,
      issue_date: fields.issue_date,
      due_date: fields.due_date,
      gross_amount: toRupeeString(fields.gross_amount_paise),
      tax_amount: toRupeeString(fields.tax_amount_paise),
      currency: fields.currency,
      status: fields.status,
      reference: fields.expected_reference ?? '',
    },
  };
  ctx.ledger.push(record);
  return record;
}

export function emitGateway(
  ctx: GenContext,
  fields: Omit<GatewayRecord, 'record_id' | 'source' | 'raw_row'>,
): GatewayRecord {
  const record: GatewayRecord = {
    record_id: ctx.nextGatewayId(),
    source: 'gateway',
    ...fields,
    raw_row: {
      payment_id: fields.payment_id,
      order_id: fields.order_id ?? '',
      receipt: fields.receipt ?? '',
      captured_at: fields.captured_at,
      amount: toRupeeString(fields.amount_paise),
      fee: toRupeeString(fields.fee_paise),
      tax_on_fee: toRupeeString(fields.tax_on_fee_paise),
      net: toRupeeString(fields.net_paise),
      method: fields.method,
      status: fields.status,
      refund: toRupeeString(fields.refund_paise),
      settlement_id: fields.settlement_id ?? '',
      settled_at: fields.settled_at ?? '',
    },
  };
  ctx.gateway.push(record);
  return record;
}

/** Balance is filled in during finalisation, once the statement is ordered. */
export function emitBank(
  ctx: GenContext,
  fields: Omit<BankRecord, 'record_id' | 'source' | 'raw_row' | 'balance_paise'>,
): BankRecord {
  const record: BankRecord = {
    record_id: ctx.nextBankId(),
    source: 'bank',
    balance_paise: 0,
    ...fields,
    raw_row: {
      value_date: fields.value_date,
      posted_at: fields.posted_at,
      narration: fields.narration,
      reference_no: fields.reference_no ?? '',
      type: fields.direction === 'credit' ? 'CR' : 'DR',
      amount: toRupeeString(fields.amount_paise),
      balance: '0.00',
    },
  };
  ctx.bank.push(record);
  return record;
}

export function emitTruth(
  ctx: GenContext,
  fields: Omit<GroundTruthEntry, 'truth_id'>,
): GroundTruthEntry {
  const entry: GroundTruthEntry = { truth_id: ctx.nextTruthId(), ...fields };
  ctx.truth.push(entry);
  return entry;
}

export type { ExceptionType };
