/** Shared building blocks: one invoice, one payment, one bank line. */

import { chance, pick, randomInt, type Rng } from '../../lib/rng';
import { computeFees, addDays, atTime, invoiceGrossPaise, invoiceTaxPaise, issueDateFor, randomTimeOn } from '../world';
import type { Customer } from '../world';
import { buildNarration, corrupt, NARRATION_TEMPLATES, pickCorruption, type Corruption } from '../narration';
import { emitBank, emitGateway, emitLedger, type GenContext } from '../context';
import type { BankRecord, GatewayRecord, LedgerRecord, PaymentMethod } from '../../domain/types';

export function nextCustomer(ctx: GenContext): Customer {
  return pick(ctx.rng, ctx.customers);
}

export function makeInvoice(
  ctx: GenContext,
  customer: Customer,
  overrides: Partial<{ grossPaise: number; issueDate: string; status: LedgerRecord['status'] }> = {},
): LedgerRecord {
  const gross = overrides.grossPaise ?? invoiceGrossPaise(ctx.rng);
  const issue = overrides.issueDate ?? issueDateFor(ctx.rng);
  const invoiceNo = ctx.nextInvoiceNo();
  return emitLedger(ctx, {
    invoice_no: invoiceNo,
    customer_id: customer.customer_id,
    customer_name: customer.customer_name,
    issue_date: issue,
    due_date: addDays(issue, pick(ctx.rng, [7, 15, 30, 45])),
    gross_amount_paise: gross,
    tax_amount_paise: invoiceTaxPaise(gross),
    currency: 'INR',
    status: overrides.status ?? 'paid',
    expected_reference: invoiceNo,
  });
}

export interface PaymentOptions {
  method?: PaymentMethod;
  amountPaise?: number;
  feeBpsOverride?: number;
  refundPaise?: number;
  settlementId?: string | null;
  settleLagDays?: number;
  receipt?: string | null;
  status?: GatewayRecord['status'];
  captureLagDays?: number;
  /** Force the settlement date. A settlement batch settles all its members together. */
  settledOn?: string;
}

export function makePayment(
  ctx: GenContext,
  invoice: LedgerRecord,
  customer: Customer,
  opts: PaymentOptions = {},
): GatewayRecord {
  const method = opts.method ?? customer.preferred_method;
  const amount = opts.amountPaise ?? invoice.gross_amount_paise;
  const captureDate = addDays(invoice.issue_date, opts.captureLagDays ?? randomInt(ctx.rng, 0, 2));
  const fees = computeFees(amount, method, opts.feeBpsOverride);
  const refund = opts.refundPaise ?? 0;
  const settlementId = opts.settlementId === undefined ? ctx.rzp.settlement() : opts.settlementId;
  const settleLag = opts.settleLagDays ?? randomInt(ctx.rng, 1, 2);
  const settledDate = opts.settledOn ?? addDays(captureDate, settleLag);

  return emitGateway(ctx, {
    payment_id: ctx.rzp.payment(),
    order_id: ctx.rzp.order(),
    receipt: opts.receipt === undefined ? invoice.invoice_no : opts.receipt,
    captured_at: randomTimeOn(ctx.rng, captureDate),
    amount_paise: amount,
    fee_paise: fees.fee_paise,
    tax_on_fee_paise: fees.tax_on_fee_paise,
    net_paise: fees.net_paise - refund,
    method,
    status: opts.status ?? (refund > 0 ? 'partially_refunded' : 'captured'),
    refund_paise: refund,
    settlement_id: settlementId,
    settled_at: settlementId ? atTime(settledDate, 11, 30) : null,
  });
}

export interface CreditOptions {
  amountPaise: number;
  valueDate: string;
  reference: string;
  settlementId: string | null;
  customerName: string;
  forceCorruption?: Corruption | null;
  direction?: 'credit' | 'debit';
  narrationOverride?: string;
}

export interface CreditResult {
  record: BankRecord;
  referenceSurvives: boolean;
  corruptions: Corruption[];
}

export function makeCredit(ctx: GenContext, opts: CreditOptions): CreditResult {
  const rng: Rng = ctx.narrationRng;
  let narration =
    opts.narrationOverride ??
    buildNarration(pick(rng, NARRATION_TEMPLATES), {
      reference: opts.reference,
      settlementId: opts.settlementId,
      customerName: opts.customerName,
      rng,
    });

  let referenceSurvives = narration.includes(opts.reference);
  const applied: Corruption[] = [];

  const globalHit = chance(ctx.corruptionRng, ctx.profile.globalNarrationCorruption);
  const which =
    opts.forceCorruption ??
    (globalHit ? pickCorruption(ctx.corruptionRng, ctx.dataset === 'hard') : null);

  if (which) {
    const result = corrupt(narration, opts.reference, opts.settlementId, which, ctx.corruptionRng);
    narration = result.narration;
    referenceSurvives = result.referenceSurvives;
    applied.push(...result.applied);
  }

  const record = emitBank(ctx, {
    value_date: opts.valueDate,
    posted_at: randomTimeOn(ctx.rng, opts.valueDate),
    narration,
    reference_no: referenceSurvives ? opts.reference : null,
    direction: opts.direction ?? 'credit',
    amount_paise: opts.amountPaise,
  });

  return { record, referenceSurvives, corruptions: applied };
}

/** Value date for the bank leg of a settlement. */
export function valueDateFor(ctx: GenContext, payment: GatewayRecord, extraLagDays = 0): string {
  const settled = (payment.settled_at ?? payment.captured_at).slice(0, 10);
  return addDays(settled, extraLagDays);
}
