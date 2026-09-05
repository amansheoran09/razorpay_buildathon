/**
 * Candidate generation for stage 4 (BUILD_SPEC section 10).
 *
 * For every record still unmatched after stage 3, build up to max_candidates
 * fully-formed potential matches, ranked by a deterministic score. The LLM
 * will only ever choose from this list - it never sees a blank page.
 */

import { daysApart, nameSimilarity, referenceSimilarity } from '../ingest/normalize';
import { formatINR, formatVariance } from '../lib/money';
import { evidence, matchReference } from './scoring';
import { commitMatch, openBankRecords, openGatewayRecords, openLedgerRecords, stageEntry, type EngineState } from './state';
import type { CandidateGroup, GatewayRecord, LedgerRecord } from '../domain/types';
import type { NormalizedBank } from '../ingest';
import type { AdjudicationRequest } from './index';

const WEIGHTS = {
  amount: 0.38,
  date: 0.18,
  reference: 0.28,
  customer: 0.1,
  method: 0.06,
} as const;

function amountProximity(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.max(0, 1 - Math.abs(a - b) / scale);
}

function dateProximity(gapDays: number, windowDays: number): number {
  return Math.max(0, 1 - gapDays / Math.max(windowDays * 3, 1));
}

function buildCandidate(
  state: EngineState,
  bank: NormalizedBank,
  gateway: GatewayRecord | null,
  ledger: LedgerRecord | null,
): CandidateGroup {
  const expected = [gateway?.settlement_id ?? '', gateway?.order_id ?? '', ledger?.invoice_no ?? ''].filter(Boolean);
  const ref = matchReference(bank, expected);
  const expectedAmount = gateway ? gateway.net_paise : (ledger?.gross_amount_paise ?? bank.amount_paise);
  const gapDays = gateway
    ? daysApart(gateway.settled_at ?? gateway.captured_at, bank.value_date)
    : ledger
      ? daysApart(ledger.issue_date, bank.value_date)
      : 0;

  const components = {
    amount_proximity: amountProximity(expectedAmount, bank.amount_paise),
    date_proximity: dateProximity(gapDays, state.config.date_window_days),
    reference_similarity: ref.matched ? ref.similarity : referenceSimilarity(bank.narration, expected[0] ?? ''),
    customer_match: ledger ? nameSimilarity(ledger.customer_name, bank.narration) : 0,
    method_plausibility: gateway ? 0.8 : 0.4,
  };

  const score =
    components.amount_proximity * WEIGHTS.amount +
    components.date_proximity * WEIGHTS.date +
    components.reference_similarity * WEIGHTS.reference +
    components.customer_match * WEIGHTS.customer +
    components.method_plausibility * WEIGHTS.method;

  const variance = expectedAmount - bank.amount_paise;
  const notes: string[] = [];
  if (Math.abs(variance) > state.config.amount_tolerance_paise) notes.push('amount does not reconcile as a single payment');
  if (gapDays > state.config.date_window_days) notes.push('settlement falls outside the date window');
  if (!ref.matched) notes.push('no direct reference match');

  return {
    candidate_id: state.nextCandidateId(),
    ledger_ids: ledger ? [ledger.record_id] : [],
    gateway_ids: gateway ? [gateway.record_id] : [],
    bank_ids: [bank.record_id],
    reconciled_amount_paise: ledger?.gross_amount_paise ?? expectedAmount,
    variance_paise: variance,
    date_gap_days: gapDays,
    score: Math.round(score * 1000) / 1000,
    score_components: components,
    evidence: [
      evidence('Amount delta vs bank', formatVariance(variance) + ' against ' + formatINR(bank.amount_paise) + '.', components.amount_proximity, [bank.record_id]),
      evidence('Date gap', gapDays + ' days.', components.date_proximity, [bank.record_id]),
      evidence('Reference similarity', components.reference_similarity.toFixed(2) + (ref.matched ? ' (' + ref.kind + ')' : ' (no direct match)'), components.reference_similarity, [bank.record_id]),
    ],
    rules_note: notes.length > 0 ? notes.join('; ') : 'all dimensions agree within tolerance',
    proposed_exception_type: Math.abs(variance) > state.config.amount_tolerance_paise ? 'AMOUNT_MISMATCH' : 'TIMING_LAG',
  };
}

/**
 * Build one escalation per still-open bank credit, each carrying its ranked
 * candidates. The match is committed now as needs_review; stage 4 may upgrade
 * it, and if stage 4 is absent this is already an honest exception.
 */
export function buildCandidates(state: EngineState): AdjudicationRequest[] {
  const started = performance.now();
  const requests: AdjudicationRequest[] = [];
  const windowDays = state.config.date_window_days;

  const openGateways = openGatewayRecords(state);
  const openLedgers = openLedgerRecords(state);

  for (const bank of openBankRecords(state)) {
    if (bank.direction !== 'credit') continue;

    const nearGateways = openGateways.filter(
      (g) => daysApart(g.settled_at ?? g.captured_at, bank.value_date) <= windowDays * 3,
    );
    const nearLedgers = openLedgers.filter((l) => daysApart(l.issue_date, bank.value_date) <= 45);

    const pool: CandidateGroup[] = [];
    for (const gateway of nearGateways.slice(0, 60)) {
      const ledger =
        openLedgers.find((l) => gateway.receipt !== null && l.invoice_no === gateway.receipt) ?? null;
      pool.push(buildCandidate(state, bank, gateway, ledger));
    }
    for (const ledger of nearLedgers.slice(0, 40)) {
      pool.push(buildCandidate(state, bank, null, ledger));
    }
    if (pool.length === 0) continue;

    const ranked = pool
      .sort((a, b) => (b.score === a.score ? (a.candidate_id < b.candidate_id ? -1 : 1) : b.score - a.score))
      .slice(0, state.config.max_candidates);

    const match = commitMatch(state, {
      tier: 'unmatched',
      confidence: 0.4,
      ledger_ids: [],
      gateway_ids: [],
      bank_ids: [bank.record_id],
      reconciled_amount_paise: bank.amount_paise,
      variance_paise: 0,
      exception_type: 'UNMATCHED_RESIDUAL',
      rationale: 'Escalated with ' + ranked.length + ' ranked candidates; no rule reached the evidence bar.',
      evidence: [evidence('Bank narration', bank.narration, 0.2, [bank.record_id])],
      candidates: ranked,
      stage_log: [
        stageEntry('stage3', 'passed_through', 'Built ' + ranked.length + ' candidates for adjudication.', ranked.length, performance.now() - started, state.now),
      ],
      forceStatus: 'needs_review',
    });

    requests.push({ match, candidates: ranked });
  }

  return requests;
}
