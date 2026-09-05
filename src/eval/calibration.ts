/**
 * Confidence calibration (BUILD_SPEC section 13).
 *
 * A system that says "90% confident" and is right 90% of the time is
 * trustworthy. Buckets every non-exact match by stated confidence into deciles
 * and compares stated confidence against actual accuracy.
 */

import type { CalibrationBucket, MatchGroup } from '../domain/types';

/**
 * Calibration covers only matches that assert a grouping.
 *
 * Confidence on an assertion means "how sure am I that these records belong
 * together", and that is checkable against ground truth. Confidence on a
 * decline - a lone bank line the system could not place - means something else
 * entirely, and it can never equal a multi-record truth group, so scoring it
 * here would drag the curve down while measuring nothing. The same predicate
 * governs the precision denominator, so the two metrics agree on what counts as
 * a claim. Declines are reported separately as `declined`.
 */
function assertsAGrouping(match: MatchGroup): boolean {
  const sources = [match.ledger_ids.length, match.gateway_ids.length, match.bank_ids.length].filter((n) => n > 0);
  if (sources.length >= 2) return true;
  return match.tier !== 'unmatched';
}

export function buildCalibration(
  matches: MatchGroup[],
  correctIds: Set<string>,
): { buckets: CalibrationBucket[]; ece: number } {
  const scored = matches.filter((m) => m.tier !== 'exact' && assertsAGrouping(m));
  const buckets: CalibrationBucket[] = [];

  for (let i = 0; i < 10; i++) {
    const lower = i / 10;
    const upper = (i + 1) / 10;
    const inBucket = scored.filter((m) =>
      i === 9 ? m.confidence >= lower && m.confidence <= upper : m.confidence >= lower && m.confidence < upper,
    );
    if (inBucket.length === 0) continue;
    const statedMean = inBucket.reduce((a, m) => a + m.confidence, 0) / inBucket.length;
    const accuracy = inBucket.filter((m) => correctIds.has(m.match_id)).length / inBucket.length;
    buckets.push({
      lower,
      upper,
      count: inBucket.length,
      stated_confidence_mean: Math.round(statedMean * 10_000) / 10_000,
      actual_accuracy: Math.round(accuracy * 10_000) / 10_000,
    });
  }

  const total = buckets.reduce((a, b) => a + b.count, 0);
  const ece =
    total === 0
      ? 0
      : Math.round(
          (buckets.reduce((a, b) => a + b.count * Math.abs(b.stated_confidence_mean - b.actual_accuracy), 0) / total) *
            10_000,
        ) / 10_000;

  return { buckets, ece };
}
