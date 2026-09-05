/** Scenarios where the shape of the money changes: merged, split, refund offset. */

import { chance, partitionInteger, randomInt } from '../../lib/rng';
import { computeFees, addDays, PERIOD_DAYS, PERIOD_START } from '../world';
import { sumPaise } from '../../lib/money';
import { emitTruth, type GenContext } from '../context';
import { makeCredit, makeInvoice, makePayment, nextCustomer, valueDateFor } from './common';
import { settlementShort } from '../narration';
import type { GatewayRecord } from '../../domain/types';

/** 2..N invoices settled in one bank credit. The subset-sum case. */
export function mergedPayment(ctx: GenContext): void {
  const count = randomInt(ctx.rng, 2, ctx.profile.mergedMaxInvoices);
  const settlementId = ctx.rzp.settlement();
  // A settlement batch pays out on one date, whatever the capture dates were.
  const settledOn = addDays(PERIOD_START, randomInt(ctx.rng, 3, PERIOD_DAYS - 4));
  const payments: GatewayRecord[] = [];
  const ledgerIds: string[] = [];
  let grossTotal = 0;

  for (let i = 0; i < count; i++) {
    const customer = nextCustomer(ctx);
    const invoice = makeInvoice(ctx, customer);
    const payment = makePayment(ctx, invoice, customer, { settlementId, settledOn });
    payments.push(payment);
    ledgerIds.push(invoice.record_id);
    grossTotal += invoice.gross_amount_paise;
  }

  const batchNet = sumPaise(payments.map((p) => p.net_paise));
  const last = payments[payments.length - 1]!;

  const { record: credit } = makeCredit(ctx, {
    amountPaise: batchNet,
    valueDate: valueDateFor(ctx, last),
    reference: settlementShort(settlementId),
    settlementId,
    customerName: 'SETTLEMENT BATCH',
  });

  // On the hard dataset a large bundle with a destroyed reference can have more
  // than one arithmetically valid subset. Those are genuinely undecidable.
  const ambiguous = ctx.dataset === 'hard' && count >= 6 && chance(ctx.corruptionRng, 0.35);

  emitTruth(ctx, {
    ledger_ids: ledgerIds,
    gateway_ids: payments.map((p) => p.record_id),
    bank_ids: [credit.record_id],
    exception_type: 'MERGED_PAYMENT',
    scenario: 'merged_payment',
    is_resolvable: !ambiguous,
    amount_paise: grossTotal,
  });
}

/** One invoice paid in 2-3 instalments, each with its own bank credit. */
export function splitPayment(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const invoice = makeInvoice(ctx, customer, { status: 'partially_paid' });
  const parts = randomInt(ctx.rng, 2, 3);
  const slices = partitionInteger(ctx.rng, invoice.gross_amount_paise, parts);

  const gatewayIds: string[] = [];
  const bankIds: string[] = [];

  slices.forEach((slice, i) => {
    const payment = makePayment(ctx, invoice, customer, {
      amountPaise: slice,
      captureLagDays: i * randomInt(ctx.rng, 2, 6),
    });
    gatewayIds.push(payment.record_id);
    const { record: credit } = makeCredit(ctx, {
      amountPaise: payment.net_paise,
      valueDate: valueDateFor(ctx, payment),
      reference: invoice.invoice_no,
      settlementId: payment.settlement_id,
      customerName: customer.customer_name,
      forceCorruption: i > 0 ? 'batch_suffix' : null,
    });
    bankIds.push(credit.record_id);
  });

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: gatewayIds,
    bank_ids: bankIds,
    exception_type: 'SPLIT_PAYMENT',
    scenario: 'split_payment',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

/** A refund netted inside a settlement batch, so the credit is short. */
export function refundOffset(ctx: GenContext): void {
  const count = randomInt(ctx.rng, 2, 4);
  const settlementId = ctx.rzp.settlement();
  const settledOn = addDays(PERIOD_START, randomInt(ctx.rng, 3, PERIOD_DAYS - 4));
  const payments: GatewayRecord[] = [];
  const ledgerIds: string[] = [];
  let grossTotal = 0;

  for (let i = 0; i < count; i++) {
    const customer = nextCustomer(ctx);
    const invoice = makeInvoice(ctx, customer);
    const isRefunded = i === 0;
    const refund = isRefunded
      ? Math.round(invoice.gross_amount_paise * (randomInt(ctx.rng, 20, 60) / 100))
      : 0;
    const payment = makePayment(ctx, invoice, customer, { settlementId, refundPaise: refund, settledOn });
    payments.push(payment);
    ledgerIds.push(invoice.record_id);
    grossTotal += invoice.gross_amount_paise;
  }

  const batchNet = sumPaise(payments.map((p) => p.net_paise));
  const last = payments[payments.length - 1]!;

  const { record: credit } = makeCredit(ctx, {
    amountPaise: batchNet,
    valueDate: valueDateFor(ctx, last),
    reference: settlementShort(settlementId),
    settlementId,
    customerName: 'SETTLEMENT BATCH',
  });

  emitTruth(ctx, {
    ledger_ids: ledgerIds,
    gateway_ids: payments.map((p) => p.record_id),
    bank_ids: [credit.record_id],
    exception_type: 'REFUND_OFFSET',
    scenario: 'refund_offset',
    is_resolvable: true,
    amount_paise: grossTotal,
  });
}

export { computeFees };
