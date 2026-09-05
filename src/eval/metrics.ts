/**
 * Scoring against ground truth (BUILD_SPEC section 13).
 *
 * A proposed match is a true positive only if its record-ID set is exactly
 * equal to a ground-truth entry's set. Partial overlap is a false positive.
 * Reconciliation is all-or-nothing and scoring it any other way would flatter
 * the system dishonestly.
 */

import { groupKey } from '../domain/types';
import { EXCEPTION_TYPES } from '../domain/taxonomy';
import type {
  CorrectlyDeclined,
  FailureReport,
  FalseNegative,
  FalsePositive,
  GroundTruth,
  GroundTruthEntry,
  MatchGroup,
} from '../domain/types';
import { buildCalibration } from './calibration';

export interface ScoreResult {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1: number;
  false_match_rate: number;
  escalation_precision: number;
  auto_cleared: number;
  needs_review: number;
  unmatched: number;
  declined: number;
  auto_clear_rate: number;
  escalation_rate: number;
  category_recall: Record<string, { total: number; caught: number; recall: number }>;
  calibration_buckets: ReturnType<typeof buildCalibration>['buckets'];
  expected_calibration_error: number;
  failures: FailureReport;
}

/**
 * Does this group assert that records belong together? A group spanning two or
 * more sources is a claim. A lone invoice with no payment and no credit is not.
 */
function isAssertion(match: MatchGroup): boolean {
  const sources = [match.ledger_ids.length, match.gateway_ids.length, match.bank_ids.length].filter((n) => n > 0);
  if (sources.length >= 2) return true;
  return match.tier !== 'unmatched';
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function scoreRun(matches: MatchGroup[], truth: GroundTruth): ScoreResult {
  const truthByKey = new Map<string, GroundTruthEntry>();
  for (const entry of truth.entries) truthByKey.set(groupKey(entry), entry);

  const matchedTruthKeys = new Set<string>();
  const correct = new Set<string>();
  const falsePositives: FalsePositive[] = [];

  for (const match of matches) {
    const key = groupKey(match);
    const hit = truthByKey.get(key);
    if (hit && !matchedTruthKeys.has(key)) {
      matchedTruthKeys.add(key);
      correct.add(match.match_id);
    } else if (!isAssertion(match)) {
      // A single-source group on the unmatched tier asserts nothing - it is the
      // system saying "I could not place this record". Counting it as a false
      // positive would conflate being wrong with declining to guess. It is
      // still punished in full by recall, via the truth entry it failed to
      // reconstruct. Recorded in DECISIONS.md.
      continue;
    } else {
      falsePositives.push({
        match_id: match.match_id,
        proposed_ids: [...match.ledger_ids, ...match.gateway_ids, ...match.bank_ids],
        true_ids: overlapIds(match, truth),
        amount_at_risk_paise: match.reconciled_amount_paise,
        confidence: match.confidence,
        tier: match.tier,
        explanation: explainFalsePositive(match, truth),
      });
    }
  }

  const falseNegatives: FalseNegative[] = [];
  const declined: CorrectlyDeclined[] = [];
  for (const entry of truth.entries) {
    const key = groupKey(entry);
    if (matchedTruthKeys.has(key)) continue;
    if (!entry.is_resolvable) {
      declined.push({
        truth_id: entry.truth_id,
        record_ids: [...entry.ledger_ids, ...entry.gateway_ids, ...entry.bank_ids],
        scenario: entry.scenario,
        note: 'Marked undecidable in ground truth. No correct automated answer exists.',
      });
    }
    falseNegatives.push({
      truth_id: entry.truth_id,
      record_ids: [...entry.ledger_ids, ...entry.gateway_ids, ...entry.bank_ids],
      scenario: entry.scenario,
      exception_type: entry.exception_type,
      amount_paise: entry.amount_paise,
      reason: entry.is_resolvable ? 'No proposed group matched this record set exactly.' : 'Genuinely undecidable.',
    });
  }

  const tp = correct.size;
  const fp = falsePositives.length;
  const declinedCount = matches.filter((m) => !isAssertion(m) && !correct.has(m.match_id)).length;
  const fn = falseNegatives.length;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);

  const autoCleared = matches.filter((m) => m.status === 'auto_cleared');
  const needsReview = matches.filter((m) => m.status === 'needs_review');
  const unmatched = matches.filter((m) => m.tier === 'unmatched');
  const badClears = autoCleared.filter((m) => !correct.has(m.match_id));

  /**
   * Escalation precision: of the items sent to a human, the share that were
   * genuinely ambiguous.
   *
   * The first version of this returned true whenever an escalation had no
   * exact ground-truth twin, which made the metric 1.0000 by construction - it
   * measured nothing and flattered the system. An escalation is only correct if
   * the records it holds actually belong to a group that carries an exception
   * or is marked undecidable. An escalation whose records belong to a clean,
   * perfectly matchable group is the system giving up on easy work, and it is
   * counted against us.
   */
  const escalatedCorrectly = needsReview.filter((m) => {
    const exact = truthByKey.get(groupKey(m));
    if (exact) return exact.exception_type !== null || !exact.is_resolvable;
    const overlap = findOverlappingTruth(m, truth);
    if (!overlap) return false;
    return overlap.exception_type !== null || !overlap.is_resolvable;
  });

  const calibration = buildCalibration(matches, correct);

  return {
    true_positives: tp,
    false_positives: fp,
    false_negatives: fn,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : Math.round(((2 * precision * recall) / (precision + recall)) * 10_000) / 10_000,
    false_match_rate: ratio(badClears.length, autoCleared.length),
    escalation_precision: ratio(escalatedCorrectly.length, needsReview.length),
    auto_cleared: autoCleared.length,
    needs_review: needsReview.length,
    unmatched: unmatched.length,
    declined: declinedCount,
    auto_clear_rate: ratio(autoCleared.length, matches.length),
    escalation_rate: ratio(needsReview.length, matches.length),
    category_recall: categoryRecall(truth, matchedTruthKeys),
    calibration_buckets: calibration.buckets,
    expected_calibration_error: calibration.ece,
    failures: {
      false_positives: falsePositives.sort((a, b) => b.amount_at_risk_paise - a.amount_at_risk_paise),
      false_negatives: falseNegatives.sort((a, b) => b.amount_paise - a.amount_paise),
      correctly_declined: declined,
    },
  };
}

/** The ground-truth group that shares the most records with this proposal. */
function findOverlappingTruth(match: MatchGroup, truth: GroundTruth): GroundTruthEntry | null {
  const proposed = new Set([...match.ledger_ids, ...match.gateway_ids, ...match.bank_ids]);
  let best: GroundTruthEntry | null = null;
  let bestOverlap = 0;
  for (const entry of truth.entries) {
    let overlap = 0;
    for (const id of [...entry.ledger_ids, ...entry.gateway_ids, ...entry.bank_ids]) {
      if (proposed.has(id)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = entry;
    }
  }
  return bestOverlap > 0 ? best : null;
}

function overlapIds(match: MatchGroup, truth: GroundTruth): string[] | null {
  const entry = findOverlappingTruth(match, truth);
  return entry ? [...entry.ledger_ids, ...entry.gateway_ids, ...entry.bank_ids] : null;
}

/** Plain-language account of why a proposal was wrong. Feeds the honesty report. */
function explainFalsePositive(match: MatchGroup, truth: GroundTruth): string {
  const entry = findOverlappingTruth(match, truth);
  if (!entry) {
    return 'Proposed a group whose records belong to no single true group. The engine assembled records that never went together.';
  }
  const proposed = new Set([...match.ledger_ids, ...match.gateway_ids, ...match.bank_ids]);
  const trueIds = [...entry.ledger_ids, ...entry.gateway_ids, ...entry.bank_ids];
  const missing = trueIds.filter((id) => !proposed.has(id));
  const extra = [...proposed].filter((id) => !trueIds.includes(id));

  const parts: string[] = ['Closest true group is ' + entry.truth_id + ' (' + entry.scenario + ').'];
  if (missing.length > 0) parts.push('Left out ' + missing.join(', ') + '.');
  if (extra.length > 0) parts.push('Wrongly included ' + extra.join(', ') + '.');
  if (missing.length === 0 && extra.length === 0) parts.push('Record sets are equal but this truth entry was already claimed by an earlier match.');
  if (entry.scenario === 'merged_payment') parts.push('Bundled settlements are the hardest case: the subset that sums correctly is not always the subset that is correct.');
  if (entry.scenario === 'narration_noise') parts.push('The bank narration carried no usable reference, so only amount and date were available.');
  return parts.join(' ');
}

function categoryRecall(
  truth: GroundTruth,
  matchedKeys: Set<string>,
): Record<string, { total: number; caught: number; recall: number }> {
  const out: Record<string, { total: number; caught: number; recall: number }> = {};
  for (const type of EXCEPTION_TYPES) out[type] = { total: 0, caught: 0, recall: 0 };
  out.NONE = { total: 0, caught: 0, recall: 0 };

  for (const entry of truth.entries) {
    const key = entry.exception_type ?? 'NONE';
    const bucket = out[key];
    if (!bucket) continue;
    bucket.total++;
    if (matchedKeys.has(groupKey(entry))) bucket.caught++;
  }
  for (const bucket of Object.values(out)) {
    bucket.recall = bucket.total === 0 ? 0 : Math.round((bucket.caught / bucket.total) * 10_000) / 10_000;
  }
  return out;
}
