/** Scenarios: clean, timing lag, fee variance, narration noise. */

import { chance, pick, randomInt } from '../../lib/rng';
import { feeBandBps, standardFeeBps, addDays } from '../world';
import { emitTruth, type GenContext } from '../context';
import { makeCredit, makeInvoice, makePayment, nextCustomer, valueDateFor } from './common';
import { settlementShort } from '../narration';

function unresolvable(ctx: GenContext): boolean {
  return chance(ctx.corruptionRng, ctx.profile.unresolvableShare);
}

/** Perfect three-way match, reference present everywhere. */
export function clean(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const invoice = makeInvoice(ctx, customer);
  const payment = makePayment(ctx, invoice, customer);
  const { record: credit } = makeCredit(ctx, {
    amountPaise: payment.net_paise,
    valueDate: valueDateFor(ctx, payment),
    reference: invoice.invoice_no,
    settlementId: payment.settlement_id,
    customerName: customer.customer_name,
  });

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [payment.record_id],
    bank_ids: [credit.record_id],
    exception_type: null,
    scenario: 'clean',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

/** Settlement lands 1-4 days after capture. Amounts agree, dates do not. */
export function timingLag(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const invoice = makeInvoice(ctx, customer);
  const payment = makePayment(ctx, invoice, customer, { settleLagDays: randomInt(ctx.rng, 1, 2) });
  const lag = randomInt(ctx.rng, 1, 4);
  const { record: credit } = makeCredit(ctx, {
    amountPaise: payment.net_paise,
    valueDate: valueDateFor(ctx, payment, lag),
    reference: invoice.invoice_no,
    settlementId: payment.settlement_id,
    customerName: customer.customer_name,
  });

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [payment.record_id],
    bank_ids: [credit.record_id],
    exception_type: 'TIMING_LAG',
    scenario: 'timing_lag',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

/**
 * Gateway fee off the standard rate for the method.
 *
 * When the applied rate stays inside the plausible band the exception is a fee
 * discrepancy. When it lands far outside, the three sources genuinely disagree
 * on the amount, which is an AMOUNT_MISMATCH. Recorded in DECISIONS.md.
 */
export function feeVariance(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const invoice = makeInvoice(ctx, customer);
  const method = customer.preferred_method;
  const standard = standardFeeBps(method);
  const band = feeBandBps(method);

  const wild = chance(ctx.rng, 0.25);
  const bps = wild
    ? standard + randomInt(ctx.rng, 120, 400)
    : randomInt(ctx.rng, Math.max(0, band.min), band.max);

  const payment = makePayment(ctx, invoice, customer, { method, feeBpsOverride: bps });
  const { record: credit } = makeCredit(ctx, {
    amountPaise: payment.net_paise,
    valueDate: valueDateFor(ctx, payment),
    reference: invoice.invoice_no,
    settlementId: payment.settlement_id,
    customerName: customer.customer_name,
  });

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [payment.record_id],
    bank_ids: [credit.record_id],
    exception_type: wild ? 'AMOUNT_MISMATCH' : 'FEE_DISCREPANCY',
    scenario: 'fee_variance',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

/** Reference garbled, truncated or absent in the bank line. */
export function narrationNoise(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const invoice = makeInvoice(ctx, customer);
  const payment = makePayment(ctx, invoice, customer);

  const destructive = pick(ctx.corruptionRng, [
    'no_reference',
    'bank_sequence',
    'settlement_instead_of_invoice',
    'truncate',
    'transpose_digits',
  ] as const);

  const { record: credit, referenceSurvives } = makeCredit(ctx, {
    amountPaise: payment.net_paise,
    valueDate: valueDateFor(ctx, payment),
    reference: invoice.invoice_no,
    settlementId: payment.settlement_id,
    customerName: customer.customer_name,
    forceCorruption: destructive,
  });

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [payment.record_id],
    bank_ids: [credit.record_id],
    exception_type: referenceSurvives ? 'TIMING_LAG' : 'NARRATION_UNPARSEABLE',
    scenario: 'narration_noise',
    is_resolvable: !(destructive === 'no_reference' && unresolvable(ctx)),
    amount_paise: invoice.gross_amount_paise,
  });
}

export { settlementShort, addDays };
