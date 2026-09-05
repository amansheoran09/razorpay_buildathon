/** Scenarios where a record is missing, doubled, or reversed. */

import { chance, pick, randomInt } from '../../lib/rng';
import { addDays, randomTimeOn } from '../world';
import { emitBank, emitGateway, emitTruth, type GenContext } from '../context';
import { makeCredit, makeInvoice, makePayment, nextCustomer, valueDateFor } from './common';
import { chargebackNarration } from '../narration';
import { toRupeeString } from '../../lib/money';

/** Gateway says settled, the bank has nothing. */
export function missingInBank(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const invoice = makeInvoice(ctx, customer);
  const payment = makePayment(ctx, invoice, customer);

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [payment.record_id],
    bank_ids: [],
    exception_type: 'MISSING_IN_BANK',
    scenario: 'missing_in_bank',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

/**
 * A direct NEFT credit with no gateway record. Sometimes there is no invoice
 * either, which is a different exception: money in with nothing to post it to.
 */
export function missingInGateway(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const noInvoice = chance(ctx.rng, 0.3);

  if (noInvoice) {
    const amount = randomInt(ctx.rng, 50_000, 4_000_000);
    const { record: credit } = makeCredit(ctx, {
      amountPaise: amount,
      valueDate: addDays('2026-03-01', randomInt(ctx.rng, 2, 28)),
      reference: 'NEFT' + randomInt(ctx.rng, 100000, 999999),
      settlementId: null,
      customerName: customer.customer_name,
    });
    emitTruth(ctx, {
      ledger_ids: [],
      gateway_ids: [],
      bank_ids: [credit.record_id],
      exception_type: 'MISSING_IN_LEDGER',
      scenario: 'missing_in_gateway',
      is_resolvable: true,
      amount_paise: amount,
    });
    return;
  }

  const invoice = makeInvoice(ctx, customer);
  const { record: credit } = makeCredit(ctx, {
    amountPaise: invoice.gross_amount_paise,
    valueDate: addDays(invoice.issue_date, randomInt(ctx.rng, 1, 5)),
    reference: invoice.invoice_no,
    settlementId: null,
    customerName: customer.customer_name,
  });

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [],
    bank_ids: [credit.record_id],
    exception_type: 'MISSING_IN_GATEWAY',
    scenario: 'missing_in_gateway',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

/** The same transaction exported twice from one source. */
export function duplicateRecord(ctx: GenContext): void {
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

  const inBank = chance(ctx.rng, 0.5);
  const extraIds: { gateway: string[]; bank: string[] } = { gateway: [], bank: [] };

  if (inBank) {
    const dupe = emitBank(ctx, {
      value_date: credit.value_date,
      posted_at: randomTimeOn(ctx.rng, credit.value_date),
      narration: credit.narration,
      reference_no: credit.reference_no,
      direction: 'credit',
      amount_paise: credit.amount_paise,
    });
    extraIds.bank.push(dupe.record_id);
  } else {
    const dupe = emitGateway(ctx, {
      payment_id: payment.payment_id,
      order_id: payment.order_id,
      receipt: payment.receipt,
      captured_at: payment.captured_at,
      amount_paise: payment.amount_paise,
      fee_paise: payment.fee_paise,
      tax_on_fee_paise: payment.tax_on_fee_paise,
      net_paise: payment.net_paise,
      method: payment.method,
      status: payment.status,
      refund_paise: payment.refund_paise,
      settlement_id: payment.settlement_id,
      settled_at: payment.settled_at,
    });
    extraIds.gateway.push(dupe.record_id);
  }

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [payment.record_id, ...extraIds.gateway],
    bank_ids: [credit.record_id, ...extraIds.bank],
    exception_type: 'DUPLICATE_RECORD',
    scenario: 'duplicate',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

/** A debit reversing a previously settled payment. */
export function chargeback(ctx: GenContext): void {
  const customer = nextCustomer(ctx);
  const invoice = makeInvoice(ctx, customer, { status: 'open' });
  const payment = makePayment(ctx, invoice, customer, { status: 'disputed' });
  const { record: credit } = makeCredit(ctx, {
    amountPaise: payment.net_paise,
    valueDate: valueDateFor(ctx, payment),
    reference: invoice.invoice_no,
    settlementId: payment.settlement_id,
    customerName: customer.customer_name,
  });

  const reversalDate = addDays(credit.value_date, randomInt(ctx.rng, 3, 12));
  const { record: debit } = makeCredit(ctx, {
    amountPaise: payment.net_paise,
    valueDate: reversalDate,
    reference: invoice.invoice_no,
    settlementId: payment.settlement_id,
    customerName: customer.customer_name,
    direction: 'debit',
    narrationOverride: chargebackNarration(
      pick(ctx.narrationRng, [invoice.invoice_no, payment.payment_id]),
      ctx.narrationRng,
    ),
  });

  emitTruth(ctx, {
    ledger_ids: [invoice.record_id],
    gateway_ids: [payment.record_id],
    bank_ids: [credit.record_id, debit.record_id],
    exception_type: 'CHARGEBACK_DEBIT',
    scenario: 'chargeback',
    is_resolvable: true,
    amount_paise: invoice.gross_amount_paise,
  });
}

export { toRupeeString };
