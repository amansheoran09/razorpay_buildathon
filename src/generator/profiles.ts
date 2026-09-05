/**
 * Scenario mix definitions (BUILD_SPEC section 8).
 *
 * This file is imported by the generator and by nothing else. The engine must
 * never import it - that separation is the direct answer to "did you tune the
 * engine to your own test set?".
 *
 * Allocation is by exact quota rather than by independent weighted draws.
 * Drawing 500 independent samples from a 62% category has a standard error of
 * about 2.2 percentage points, which would breach the +/-1.5pp acceptance
 * criterion by chance alone. Quotas make the mix exact and still deterministic.
 */

import { shuffle, type Rng } from '../lib/rng';
import type { DatasetName } from '../domain/types';

export const SCENARIOS = [
  'clean',
  'timing_lag',
  'merged_payment',
  'split_payment',
  'fee_variance',
  'refund_offset',
  'narration_noise',
  'missing_in_bank',
  'missing_in_gateway',
  'duplicate',
  'chargeback',
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];

export interface DatasetProfile {
  dataset: DatasetName;
  mix: Record<ScenarioName, number>;
  /** Upper bound on invoices bundled into one bank credit. */
  mergedMaxInvoices: number;
  /** Probability that any bank line gets narration corruption, regardless of scenario. */
  globalNarrationCorruption: number;
  /** Share of groups marked genuinely undecidable. */
  unresolvableShare: number;
  /**
   * Share of non-critical amount cells written as garbage. Real exports carry
   * these. They land in tax/fee/balance columns rather than the primary amount,
   * so the row survives ingest with a counted warning instead of vanishing and
   * shifting every positional record id after it.
   */
  malformedCellRate: number;
}

export const STANDARD_PROFILE: DatasetProfile = {
  dataset: 'standard',
  mix: {
    clean: 62,
    timing_lag: 8,
    merged_payment: 7,
    split_payment: 4,
    fee_variance: 4,
    refund_offset: 4,
    narration_noise: 4,
    missing_in_bank: 2,
    missing_in_gateway: 2,
    duplicate: 1.5,
    chargeback: 1.5,
  },
  mergedMaxInvoices: 5,
  globalNarrationCorruption: 0,
  unresolvableShare: 0,
  malformedCellRate: 0.006,
};

/**
 * The hard dataset: clean drops to 30%, bundles go to 8 invoices, 40% of all
 * bank lines are corrupted, and 3% of groups are genuinely undecidable.
 * The remaining 70% is the standard non-clean mix scaled proportionally.
 */
export const HARD_PROFILE: DatasetProfile = {
  dataset: 'hard',
  mix: {
    clean: 30,
    timing_lag: 14.74,
    merged_payment: 12.89,
    split_payment: 7.37,
    fee_variance: 7.37,
    refund_offset: 7.37,
    narration_noise: 7.37,
    missing_in_bank: 3.68,
    missing_in_gateway: 3.68,
    duplicate: 2.76,
    chargeback: 2.77,
  },
  mergedMaxInvoices: 8,
  globalNarrationCorruption: 0.4,
  unresolvableShare: 0.03,
  malformedCellRate: 0.025,
};

export function profileFor(dataset: DatasetName): DatasetProfile {
  return dataset === 'hard' ? HARD_PROFILE : STANDARD_PROFILE;
}

/**
 * Turn a percentage mix into an exact, shuffled list of scenario assignments.
 * Largest-remainder rounding so the counts sum to `total` precisely.
 */
export function allocateScenarios(rng: Rng, total: number, profile: DatasetProfile): ScenarioName[] {
  const weights = SCENARIOS.map((s) => profile.mix[s]);
  const sum = weights.reduce((a, b) => a + b, 0);

  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map((e) => Math.floor(e));
  let assigned = counts.reduce((a, b) => a + b, 0);

  const remainders = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => (b.rem === a.rem ? a.i - b.i : b.rem - a.rem));

  let cursor = 0;
  while (assigned < total) {
    const entry = remainders[cursor % remainders.length]!;
    counts[entry.i] = (counts[entry.i] ?? 0) + 1;
    assigned++;
    cursor++;
  }

  const out: ScenarioName[] = [];
  SCENARIOS.forEach((name, i) => {
    for (let k = 0; k < (counts[i] ?? 0); k++) out.push(name);
  });
  return shuffle(rng, out);
}
