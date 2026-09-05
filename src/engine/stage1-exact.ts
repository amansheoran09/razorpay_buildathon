/**
 * Stage 1 - exact match (BUILD_SPEC section 10).
 *
 * Strong identity only: the gateway receipt IS the invoice number, the bank
 * line carries the settlement or order reference, amounts agree exactly after
 * fees, and the dates are in a sane order. Confidence 1.0, auto-cleared.
 *
 * This stage must produce zero false positives. Everything it cannot prove is
 * left for stage 2.
 */

import { normalizeRef } from '../ingest/normalize';
import { dateOnly, daysApart } from '../ingest/normalize';
import { amountEvidence, dateEvidence, exactReferenceEvidence, matchReference, referenceEvidence } from './scoring';
import { commitMatch, creditsNearAmount, openLedgerRecords, stageEntry, type EngineState } from './state';
import type { NormalizedBank } from '../ingest';
import type { GatewayRecord } from '../domain/types';

function datesAreOrdered(issue: string, captured: string, settled: string | null, valueDate: string): boolean {
  const i = dateOnly(issue);
  const c = dateOnly(captured);
  const s = settled ? dateOnly(settled) : c;
  const v = dateOnly(valueDate);
  return i <= c && c <= s && s <= v;
}

export function runStage1(state: EngineState): { matched: number; durationMs: number } {
  const started = performance.now();
  let matched = 0;

  for (const ledger of openLedgerRecords(state)) {
    state.tick('stage1');
    const receiptKey = normalizeRef(ledger.invoice_no);
    const candidates = (state.gatewayByReceipt.get(receiptKey) ?? []).filter(
      (g) => state.openGateway.has(g.record_id),
    );
    if (candidates.length !== 1) continue;

    const gateway = candidates[0] as GatewayRecord;
    if (gateway.amount_paise !== ledger.gross_amount_paise) continue;
    if (gateway.refund_paise !== 0) continue;
    if (gateway.status !== 'captured') continue;
    if (!gateway.settlement_id) continue;

    const expected: string[] = [gateway.settlement_id, gateway.order_id ?? '', ledger.invoice_no].filter(Boolean);

    // Stage 1 requires the credit to equal the settlement net exactly, so the
    // amount index returns precisely the set a full scan would have kept.
    const bankHits: NormalizedBank[] = [];
    for (const bank of creditsNearAmount(state, gateway.net_paise, 0)) {
      const ref = matchReference(bank, expected);
      if (!ref.matched || (ref.kind !== 'exact' && ref.kind !== 'contains')) continue;
      if (!datesAreOrdered(ledger.issue_date, gateway.captured_at, gateway.settled_at, bank.value_date)) continue;
      // An exact match settles inside the window. A longer lag is a real
      // observation about the business, so it belongs to stage 2 with a
      // TIMING_LAG note rather than being cleared silently here.
      if (daysApart(gateway.settled_at ?? gateway.captured_at, bank.value_date) > state.config.date_window_days) continue;
      bankHits.push(bank);
    }

    // Ambiguity is not a match. Two candidate credits go to a later stage.
    if (bankHits.length !== 1) continue;
    const bank = bankHits[0] as NormalizedBank;

    // If a reversing debit for this payment is still open, the true group has
    // four records, not three. Clearing three of them would be a false match,
    // so this is left for the attachment pass.
    const hasReversal = (state.bankDebitsByAmount.get(bank.amount_paise) ?? []).some(
      (b) => state.openBank.has(b.record_id) && matchReference(b, expected).matched,
    );
    if (hasReversal) continue;

    const ref = matchReference(bank, expected);
    const durationMs = performance.now() - started;

    commitMatch(state, {
      tier: 'exact',
      confidence: 1,
      ledger_ids: [ledger.record_id],
      gateway_ids: [gateway.record_id],
      bank_ids: [bank.record_id],
      reconciled_amount_paise: ledger.gross_amount_paise,
      variance_paise: 0,
      exception_type: null,
      rationale:
        'Invoice, payment and credit agree exactly: receipt equals invoice number and the bank line carries the settlement reference.',
      evidence: [
        exactReferenceEvidence(ledger, gateway),
        referenceEvidence(ref, gateway.settlement_id, [gateway.record_id, bank.record_id]),
        amountEvidence(gateway.net_paise, bank.amount_paise, 0, [gateway.record_id, bank.record_id]),
        dateEvidence(gateway.captured_at, bank.value_date, state.config.date_window_days, [
          gateway.record_id,
          bank.record_id,
        ]),
      ],
      stage_log: [
        stageEntry('stage1', 'matched', 'Exact three-way identity match.', 1, durationMs, state.now),
      ],
    });
    matched++;
  }

  return { matched, durationMs: performance.now() - started };
}
