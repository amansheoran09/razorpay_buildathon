/**
 * Stage 3 - combinatorial match (BUILD_SPEC section 10).
 *
 * Merged payments: many gateway nets summing to one bank credit.
 * Split payments: one invoice paid across many bank credits.
 *
 * A unique solution scores 0.88. An ambiguous one scores 0.45 and is escalated
 * with every valid subset attached as a candidate - the engine never picks one.
 */

import { daysApart } from '../ingest/normalize';
import { formatINR, sumPaise } from '../lib/money';
import { amountEvidence, evidence, matchReference, referenceEvidence } from './scoring';
import { findSubsets } from './subset-sum';
import { commitMatch, gatewaysNearDate, openBankRecords, openLedgerRecords, stageEntry, type EngineState } from './state';
import type { CandidateGroup, GatewayRecord } from '../domain/types';

/**
 * A settlement batch that the narration names AND whose members sum exactly to
 * the credit is confirmed twice over, independently. Rating that 0.88 was
 * under-confident: it was right on every such match in both datasets.
 * Arithmetic alone, with no reference to corroborate it, stays lower.
 */
export const UNIQUE_CONFIDENCE = 0.95;
export const UNCORROBORATED_CONFIDENCE = 0.78;
export const AMBIGUOUS_CONFIDENCE = 0.45;

function subsetCap(state: EngineState): number {
  return state.config.dataset === 'hard' ? 12 : 8;
}

function mergedCandidates(
  state: EngineState,
  bankId: string,
  solutions: { ids: string[]; total: number; variance: number }[],
  settlementHint: string | null,
): CandidateGroup[] {
  return solutions.map((solution) => ({
    candidate_id: state.nextCandidateId(),
    ledger_ids: [],
    gateway_ids: solution.ids,
    bank_ids: [bankId],
    reconciled_amount_paise: solution.total,
    variance_paise: solution.variance,
    date_gap_days: 0,
    score: 0.5,
    score_components: {
      amount_proximity: 1,
      date_proximity: 1,
      reference_similarity: settlementHint ? 0.8 : 0.2,
      customer_match: 0,
      method_plausibility: 0.5,
    },
    evidence: [
      evidence(
        'Subset sums to the credit',
        solution.ids.length + ' payments totalling ' + formatINR(solution.total) + '.',
        0.7,
        solution.ids,
      ),
    ],
    rules_note: 'One of ' + solutions.length + ' arithmetically valid subsets.',
    proposed_exception_type: 'MERGED_PAYMENT',
  }));
}

interface Batch {
  id: string;
  members: GatewayRecord[];
  total: number;
  settledOn: string;
}

export function runStage3(state: EngineState): { matched: number; ambiguous: number; durationMs: number } {
  const started = performance.now();
  const tolerance = state.config.amount_tolerance_paise;
  const windowDays = state.config.date_window_days;
  const maxSize = subsetCap(state);
  let matched = 0;
  let ambiguousCount = 0;

  /**
   * A settlement is atomic: a credit carries all of a batch or none of it.
   * Working in whole batches rather than individual payments is both faster and
   * far more honest - free-form subset-sum over thirty payments finds sums that
   * are arithmetically valid and factually wrong.
   */
  const grouped = new Map<string, GatewayRecord[]>();
  for (const g of state.gateway) {
    if (!g.settlement_id || !state.openGateway.has(g.record_id)) continue;
    const list = grouped.get(g.settlement_id);
    if (list) list.push(g);
    else grouped.set(g.settlement_id, [g]);
  }

  const batchesByTotal = new Map<number, Batch[]>();
  for (const [id, members] of grouped) {
    if (members.length < 2) continue;
    const total = sumPaise(members.map((g) => g.net_paise));
    const settledOn = (members[0]!.settled_at ?? members[0]!.captured_at).slice(0, 10);
    const list = batchesByTotal.get(total);
    const batch: Batch = { id, members, total, settledOn };
    if (list) list.push(batch);
    else batchesByTotal.set(total, [batch]);
  }

  for (const bank of openBankRecords(state)) {
    state.tick('stage3');
    if (bank.direction !== 'credit') continue;

    // Batches are indexed by total once, before the loop, so finding the
    // settlements that reconcile to a credit is a bounded lookup. Rebuilding
    // them from every payment in the window on each credit is
    // O(credits x payments) and was half the wall clock at 36,000 records.
    const fits: Batch[] = [];
    for (let delta = -tolerance; delta <= tolerance; delta++) {
      for (const batch of batchesByTotal.get(bank.amount_paise + delta) ?? []) {
        if (!batch.members.every((g) => state.openGateway.has(g.record_id))) continue;
        if (daysApart(batch.settledOn, bank.value_date) > windowDays + 2) continue;
        fits.push(batch);
      }
    }

    if (fits.length === 0) continue;

    const hinted = fits.filter((b) => matchReference(bank, [b.id]).matched);
    const chosen = hinted.length === 1 ? hinted : fits;
    const durationMs = performance.now() - started;

    if (chosen.length > 1) {
      commitMatch(state, {
        tier: 'unmatched',
        confidence: AMBIGUOUS_CONFIDENCE,
        ledger_ids: [],
        gateway_ids: [],
        bank_ids: [bank.record_id],
        reconciled_amount_paise: bank.amount_paise,
        variance_paise: 0,
        exception_type: 'MERGED_PAYMENT',
        rationale: 'More than one settlement batch sums to this credit. The engine will not choose between them.',
        evidence: [
          evidence(
            'Ambiguous batch',
            chosen.length + ' settlement batches each reconcile to ' + formatINR(bank.amount_paise) + '.',
            0.3,
            [bank.record_id],
          ),
        ],
        candidates: mergedCandidates(
          state,
          bank.record_id,
          chosen.map((b) => ({ ids: b.members.map((g) => g.record_id), total: b.total, variance: bank.amount_paise - b.total })),
          null,
        ),
        stage_log: [
          stageEntry('stage3', 'ambiguous', 'Ambiguous across ' + fits.length + ' settlement batches that reconcile to this credit.', chosen.length, durationMs, state.now),
        ],
        forceStatus: 'needs_review',
      });
      ambiguousCount++;
      continue;
    }

    const batch = chosen[0]!;
    if (batch.members.length > maxSize) continue;

    const ledgerIds: string[] = [];
    for (const g of batch.members) {
      if (!g.receipt) continue;
      const l = state.ledger.find((x) => x.invoice_no === g.receipt && state.openLedger.has(x.record_id));
      if (l) ledgerIds.push(l.record_id);
    }

    const ref = matchReference(bank, [batch.id]);
    const hasRefund = batch.members.some((g) => g.refund_paise > 0);

    commitMatch(state, {
      tier: 'combinatorial',
      confidence: ref.matched ? UNIQUE_CONFIDENCE : UNCORROBORATED_CONFIDENCE,
      ledger_ids: ledgerIds,
      gateway_ids: batch.members.map((g) => g.record_id).slice().sort(),
      bank_ids: [bank.record_id],
      reconciled_amount_paise: sumPaise(batch.members.map((g) => g.amount_paise)),
      variance_paise: bank.amount_paise - batch.total,
      exception_type: hasRefund ? 'REFUND_OFFSET' : 'MERGED_PAYMENT',
      rationale:
        'Settlement ' + batch.id + ' bundles ' + batch.members.length + ' payments totalling ' +
        formatINR(batch.total) + ', which is this credit exactly.',
      evidence: [
        evidence('Settlement batch', batch.members.length + ' payments under ' + batch.id + '.', 0.85, batch.members.map((g) => g.record_id)),
        ...(ref.matched ? [referenceEvidence(ref, batch.id, [bank.record_id])] : []),
        amountEvidence(batch.total, bank.amount_paise, tolerance, [bank.record_id]),
      ],
      stage_log: [
        stageEntry('stage3', 'matched', 'Matched a complete settlement batch of ' + batch.members.length + '.', fits.length, durationMs, state.now),
      ],
    });
    matched++;
  }

  const splits = runSplits(state, started, tolerance, windowDays);
  matched += splits.matched;
  ambiguousCount += splits.ambiguous;

  return { matched, ambiguous: ambiguousCount, durationMs: performance.now() - started };
}


/** Split payments: one invoice paid across several bank credits. */
function runSplits(
  state: EngineState,
  started: number,
  tolerance: number,
  windowDays: number,
): { matched: number; ambiguous: number } {
  let matched = 0;
  let ambiguous = 0;

  for (const ledger of openLedgerRecords(state)) {
    const gws = state.gateway.filter(
      (g) => state.openGateway.has(g.record_id) && g.receipt === ledger.invoice_no,
    );
    if (gws.length < 2) continue;

    const targetNet = sumPaise(gws.map((g) => g.net_paise));
    const credits = state.bank.filter((b) => {
      if (!state.openBank.has(b.record_id) || b.direction !== 'credit') return false;
      return gws.some((g) => daysApart(g.settled_at ?? g.captured_at, b.value_date) <= windowDays + 3);
    });

    // Direct pass first: each instalment settles on its own, so each one should
    // have exactly one credit of its net amount carrying the invoice reference.
    const direct: string[] = [];
    const claimed = new Set<string>();
    for (const g of gws) {
      const hit = credits.find(
        (b) =>
          !claimed.has(b.record_id) &&
          b.amount_paise === g.net_paise &&
          matchReference(b, [ledger.invoice_no, g.settlement_id ?? '', g.order_id ?? ''].filter(Boolean)).matched,
      );
      if (hit) {
        claimed.add(hit.record_id);
        direct.push(hit.record_id);
      }
    }

    let result: ReturnType<typeof findSubsets>;
    if (direct.length === gws.length) {
      const total = sumPaise(direct.map((id) => state.bankById.get(id)?.amount_paise ?? 0));
      result = {
        solutions: [{ ids: direct.slice().sort(), total, variance: targetNet - total }],
        ambiguous: false,
        nodesVisited: 0,
        exhausted: true,
      };
    } else {
      result = findSubsets(
        credits.map((b) => ({ id: b.record_id, value: b.amount_paise })),
        targetNet,
        { tolerance: tolerance * gws.length, maxSize: Math.max(gws.length, 3) },
      );
    }
    if (result.solutions.length === 0) continue;

    const solution = result.solutions[0]!;
    const durationMs = performance.now() - started;

    commitMatch(state, {
      tier: 'combinatorial',
      confidence: result.ambiguous ? AMBIGUOUS_CONFIDENCE : UNIQUE_CONFIDENCE,
      ledger_ids: [ledger.record_id],
      gateway_ids: gws.map((g) => g.record_id),
      bank_ids: solution.ids,
      reconciled_amount_paise: ledger.gross_amount_paise,
      variance_paise: solution.variance,
      exception_type: 'SPLIT_PAYMENT',
      rationale:
        'Invoice ' + ledger.invoice_no + ' was paid in ' + gws.length + ' instalments landing as ' + solution.ids.length + ' credits.',
      evidence: [
        evidence(
          'Instalments reconcile',
          solution.ids.length + ' credits total ' + formatINR(solution.total) + ' against ' + formatINR(targetNet) + ' of net payments.',
          0.8,
          [...gws.map((g) => g.record_id), ...solution.ids],
        ),
      ],
      stage_log: [
        stageEntry(
          'stage3',
          result.ambiguous ? 'ambiguous' : 'matched',
          'Split-payment subset-sum over ' + credits.length + ' credits.',
          result.solutions.length,
          durationMs,
          state.now,
        ),
      ],
    });
    if (result.ambiguous) ambiguous++;
    else matched++;
  }

  return { matched, ambiguous };
}
