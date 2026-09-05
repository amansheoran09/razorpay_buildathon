/**
 * Stage 2 - tolerant match (BUILD_SPEC section 10).
 *
 * Relax one dimension at a time and score the result. Base confidence 0.98,
 * penalties subtract. Anything that lands below the auto-clear threshold is
 * left open rather than committed, so stages 3 and 4 can still see it.
 */

import { daysApart, normalizeRef } from '../ingest/normalize';
import { formatINR } from '../lib/money';
import {
  BASE_TOLERANT_CONFIDENCE,
  PENALTY,
  amountEvidence,
  clampConfidence,
  customerEvidence,
  dateEvidence,
  feeEvidence,
  feeWithinBand,
  matchReference,
  referenceEvidence,
} from './scoring';
import { commitMatch, creditsNearAmount, openLedgerRecords, stageEntry, type EngineState } from './state';
import type { EvidenceItem, GatewayRecord } from '../domain/types';
import type { ExceptionType } from '../domain/taxonomy';
import type { NormalizedBank } from '../ingest';

interface Scored {
  gateway: GatewayRecord;
  bank: NormalizedBank | null;
  confidence: number;
  variance: number;
  evidence: EvidenceItem[];
  exception: ExceptionType | null;
  notes: string[];
}

function findGateway(state: EngineState, invoiceNo: string): GatewayRecord | null {
  const key = normalizeRef(invoiceNo);
  const direct = (state.gatewayByReceipt.get(key) ?? []).filter((g) => state.openGateway.has(g.record_id));
  if (direct.length === 1) return direct[0] as GatewayRecord;
  if (direct.length > 1) return null;

  // Receipt garbled or absent: fall back to a suffix match on the receipt.
  const suffix = key.slice(-6);
  const fuzzy = state.gateway.filter(
    (g) => state.openGateway.has(g.record_id) && g.receipt && normalizeRef(g.receipt).slice(-6) === suffix,
  );
  return fuzzy.length === 1 ? (fuzzy[0] as GatewayRecord) : null;
}

export function runStage2(state: EngineState): { matched: number; durationMs: number } {
  const started = performance.now();
  const { amount_tolerance_paise: tolerance, date_window_days: windowDays } = state.config;
  let matched = 0;

  for (const ledger of openLedgerRecords(state)) {
    state.tick('stage2');
    const gateway = findGateway(state, ledger.invoice_no);
    if (!gateway) continue;

    const expected = [gateway.settlement_id ?? '', gateway.order_id ?? '', ledger.invoice_no].filter(Boolean);
    let best: Scored | null = null;

    /**
     * Only credits within the amount tolerance are considered.
     *
     * Stage 2 commits nothing below the auto-clear threshold. Base confidence
     * is 0.98 and an amount outside tolerance costs 0.30, so such a candidate
     * tops out at 0.68 and can never be committed however good its reference
     * is. Narrowing here discards only work the engine would have thrown away,
     * and turns a full statement scan per invoice into a bounded lookup. The
     * run output hash is unchanged, which is the proof.
     */
    for (const bank of creditsNearAmount(state, gateway.net_paise, tolerance)) {
      const variance = gateway.net_paise - bank.amount_paise;
      const gap = daysApart(gateway.settled_at ?? gateway.captured_at, bank.value_date);
      if (Math.abs(variance) > tolerance && gap > windowDays + 4) continue;

      const ref = matchReference(bank, expected);
      if (!ref.matched && Math.abs(variance) > tolerance) continue;

      let confidence = BASE_TOLERANT_CONFIDENCE;
      const evidence: EvidenceItem[] = [];
      const notes: string[] = [];
      let exception: ExceptionType | null = null;

      evidence.push(referenceEvidence(ref, expected[0] ?? ledger.invoice_no, [gateway.record_id, bank.record_id]));
      confidence -= ref.penalty;
      if (ref.penalty === PENALTY.reference_last6_only) notes.push('reference matched on last 6 only');
      if (ref.penalty === PENALTY.reference_transposition) notes.push('reference near-match');
      if (!ref.matched) {
        confidence -= 0.25;
        exception = 'NARRATION_UNPARSEABLE';
        notes.push('no usable reference in narration');
      }

      evidence.push(amountEvidence(gateway.net_paise, bank.amount_paise, tolerance, [gateway.record_id, bank.record_id]));
      if (variance !== 0) {
        if (Math.abs(variance) <= tolerance) {
          confidence -= PENALTY.amount_within_tolerance;
          notes.push('amount within tolerance');
        } else {
          confidence -= 0.3;
          exception = 'AMOUNT_MISMATCH';
          notes.push('amount outside tolerance');
        }
      }

      evidence.push(dateEvidence(gateway.captured_at, bank.value_date, windowDays, [gateway.record_id, bank.record_id]));
      if (gap > 0) {
        confidence -= PENALTY.date_window_widened;
        if (gap > windowDays) {
          exception = exception ?? 'TIMING_LAG';
          notes.push('settlement outside the ' + windowDays + ' day window');
        }
      }

      const fee = feeWithinBand(gateway);
      evidence.push(feeEvidence(gateway));
      if (!fee) {
        confidence -= PENALTY.fee_within_band;
        exception = exception ?? 'FEE_DISCREPANCY';
        notes.push('gateway fee outside the expected band');
      }

      const customer = customerEvidence(ledger, bank.narration);
      if (customer.ratio >= 0.4) {
        evidence.push(customer.item);
        if (customer.ratio < 0.85) confidence -= PENALTY.customer_fuzzy;
      }

      if (gateway.refund_paise > 0) {
        exception = exception ?? 'REFUND_OFFSET';
        notes.push('a refund of ' + formatINR(gateway.refund_paise) + ' is netted in this settlement');
      }

      const scored: Scored = {
        gateway,
        bank,
        confidence: clampConfidence(confidence),
        variance,
        evidence,
        exception,
        notes,
      };
      if (!best || scored.confidence > best.confidence) best = scored;
    }

    if (!best || !best.bank) continue;
    if (best.confidence < state.config.auto_clear_threshold) continue;

    const durationMs = performance.now() - started;
    commitMatch(state, {
      tier: 'tolerant',
      confidence: best.confidence,
      ledger_ids: [ledger.record_id],
      gateway_ids: [gateway.record_id],
      bank_ids: [best.bank.record_id],
      reconciled_amount_paise: ledger.gross_amount_paise,
      variance_paise: best.variance,
      exception_type: best.exception,
      rationale:
        best.notes.length > 0
          ? 'Matched after relaxing: ' + best.notes.join('; ') + '.'
          : 'Matched on reference, amount and date with no relaxation required.',
      evidence: best.evidence,
      stage_log: [
        stageEntry('stage2', 'matched', 'Tolerant match at confidence ' + best.confidence.toFixed(2) + '.', 1, durationMs, state.now),
      ],
    });
    matched++;
  }

  return { matched, durationMs: performance.now() - started };
}
