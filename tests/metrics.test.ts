import { describe, expect, it } from 'vitest';
import { scoreRun } from '../src/eval/metrics';
import { buildCalibration } from '../src/eval/calibration';
import type { GroundTruth, MatchGroup } from '../src/domain/types';

function match(over: Partial<MatchGroup>): MatchGroup {
  return {
    match_id: 'MCH-000001',
    run_id: 'T',
    tier: 'tolerant',
    confidence: 0.95,
    ledger_ids: [],
    gateway_ids: [],
    bank_ids: [],
    reconciled_amount_paise: 100000,
    variance_paise: 0,
    exception_type: null,
    status: 'auto_cleared',
    rationale: 'fixture',
    evidence: [],
    decided_by: 'rules',
    decided_at: 'now',
    stage_log: [],
    llm_call_id: null,
    ...over,
  };
}

const truth: GroundTruth = {
  dataset: 'standard',
  seed: 1,
  generated_at: 'now',
  entries: [
    { truth_id: 'T1', ledger_ids: ['L1'], gateway_ids: ['G1'], bank_ids: ['B1'], exception_type: null, scenario: 'clean', is_resolvable: true, amount_paise: 100000 },
    { truth_id: 'T2', ledger_ids: ['L2'], gateway_ids: ['G2'], bank_ids: ['B2'], exception_type: 'TIMING_LAG', scenario: 'timing_lag', is_resolvable: true, amount_paise: 200000 },
    { truth_id: 'T3', ledger_ids: ['L3'], gateway_ids: ['G3'], bank_ids: ['B3'], exception_type: 'MERGED_PAYMENT', scenario: 'merged_payment', is_resolvable: true, amount_paise: 300000 },
    { truth_id: 'T4', ledger_ids: ['L4'], gateway_ids: ['G4'], bank_ids: ['B4'], exception_type: 'NARRATION_UNPARSEABLE', scenario: 'narration_noise', is_resolvable: false, amount_paise: 400000 },
  ],
};

describe('scoring against ground truth', () => {
  // Two exactly right, one wrong pairing, one truth group never proposed.
  const matches: MatchGroup[] = [
    match({ match_id: 'M1', ledger_ids: ['L1'], gateway_ids: ['G1'], bank_ids: ['B1'] }),
    match({ match_id: 'M2', ledger_ids: ['L2'], gateway_ids: ['G2'], bank_ids: ['B2'], exception_type: 'TIMING_LAG', status: 'needs_review', confidence: 0.75 }),
    match({ match_id: 'M3', ledger_ids: ['L3'], gateway_ids: ['G4'], bank_ids: ['B3'] }),
  ];
  const result = scoreRun(matches, truth);

  it('counts exact set equality only', () => {
    expect(result.true_positives).toBe(2);
    expect(result.false_positives).toBe(1);
  });

  it('gives no partial credit for overlap', () => {
    const overlap = result.failures.false_positives.find((f) => f.match_id === 'M3');
    expect(overlap).toBeDefined();
    expect(overlap?.explanation).toContain('Wrongly included');
  });

  it('computes precision, recall and f1 from those counts', () => {
    expect(result.precision).toBeCloseTo(2 / 3, 4);
    expect(result.recall).toBeCloseTo(2 / 4, 4);
    expect(result.f1).toBeCloseTo((2 * (2 / 3) * 0.5) / (2 / 3 + 0.5), 3);
  });

  it('reports the false-match rate over auto-clears only', () => {
    // Two auto-cleared (M1 correct, M3 wrong) -> one bad clear in two.
    expect(result.false_match_rate).toBeCloseTo(0.5, 4);
  });

  it('counts an undecidable group as correctly declined', () => {
    expect(result.failures.correctly_declined.map((d) => d.truth_id)).toEqual(['T4']);
  });

  it('reports per-category recall', () => {
    expect(result.category_recall.NONE?.recall).toBe(1);
    expect(result.category_recall.TIMING_LAG?.recall).toBe(1);
    expect(result.category_recall.MERGED_PAYMENT?.recall).toBe(0);
  });

  it('measures escalation precision against real exceptions', () => {
    expect(result.escalation_precision).toBe(1);
  });
});

describe('calibration', () => {
  it('is perfect when stated confidence equals observed accuracy', () => {
    const matches = [
      ...Array.from({ length: 10 }, (_, i) => match({ match_id: 'A' + i, confidence: 0.95 })),
      ...Array.from({ length: 10 }, (_, i) => match({ match_id: 'B' + i, confidence: 0.55 })),
    ];
    const correct = new Set([
      ...Array.from({ length: 10 }, (_, i) => 'A' + i).slice(0, 10),
      ...Array.from({ length: 10 }, (_, i) => 'B' + i).slice(0, 5),
    ]);
    const { buckets, ece } = buildCalibration(matches, correct);
    expect(buckets.length).toBe(2);
    expect(ece).toBeLessThan(0.06);
  });

  it('reports a large error when the system is overconfident', () => {
    const matches = Array.from({ length: 10 }, (_, i) => match({ match_id: 'C' + i, confidence: 0.99 }));
    const { ece } = buildCalibration(matches, new Set<string>());
    expect(ece).toBeGreaterThan(0.9);
  });

  it('excludes exact-tier matches, which are true by construction', () => {
    const matches = [match({ match_id: 'E1', tier: 'exact', confidence: 1 })];
    expect(buildCalibration(matches, new Set(['E1'])).buckets.length).toBe(0);
  });
});

describe('metrics do not flatter the system', () => {
  const declineOnly: MatchGroup[] = [
    match({ match_id: 'D1', tier: 'unmatched', bank_ids: ['B9'], status: 'needs_review', confidence: 0.4 }),
  ];

  it('an escalation whose records belong to a clean group counts against us', () => {
    // T1 is a clean, fully matchable group. Escalating it is giving up on easy work.
    const escalated: MatchGroup[] = [
      match({ match_id: 'E1', ledger_ids: ['L1'], gateway_ids: ['G1'], bank_ids: [], status: 'needs_review', confidence: 0.5 }),
    ];
    expect(scoreRun(escalated, truth).escalation_precision).toBe(0);
  });

  it('an escalation on a genuinely exceptional group counts for us', () => {
    const escalated: MatchGroup[] = [
      match({ match_id: 'E2', ledger_ids: ['L3'], gateway_ids: ['G3'], bank_ids: [], status: 'needs_review', confidence: 0.5 }),
    ];
    expect(scoreRun(escalated, truth).escalation_precision).toBe(1);
  });

  it('escalation precision cannot be 1.0 by construction', () => {
    // A one-sided decline that overlaps nothing must not be scored as a win.
    expect(scoreRun(declineOnly, truth).escalation_precision).toBe(0);
  });

  it('calibration ignores declines, matching the precision denominator', () => {
    const mixed: MatchGroup[] = [
      match({ match_id: 'A1', ledger_ids: ['L1'], gateway_ids: ['G1'], bank_ids: ['B1'], confidence: 0.95 }),
      ...declineOnly,
    ];
    const result = scoreRun(mixed, truth);
    const counted = result.calibration_buckets.reduce((a, b) => a + b.count, 0);
    expect(counted).toBe(1);
    expect(result.declined).toBe(1);
  });
});
