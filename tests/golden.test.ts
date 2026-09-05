import { describe, expect, it } from 'vitest';
import { executeRun } from '../src/run';

/**
 * Golden hashes.
 *
 * The output hash covers every match decision in a run. Pinning it here means
 * any change that alters what the engine decides fails loudly, which is what
 * made the performance work safe: stages 1 to 3 were rewritten from full scans
 * to indexed lookups and these hashes did not move, which is the proof the
 * rewrite changed only speed.
 *
 * If a change is meant to alter decisions, update these deliberately and say so
 * in DECISIONS.md. Do not update them to make a red test go green.
 */
const GOLDEN: Record<string, { hash: string; precision: number; recall: number; falseMatchRate: number }> = {
  standard: {
    hash: 'c9941f1f3de9de0d7a567e3f11a89c8584e0d388602c58eea61656089d3ed508',
    precision: 0.976,
    recall: 0.976,
    falseMatchRate: 0,
  },
  hard: {
    hash: '15975cb5161cf2787b3ee7b6e8e32cfe966fd7c616256aa340948af9a4e56430',
    precision: 0.8089,
    recall: 0.804,
    falseMatchRate: 0.0044,
  },
};

describe('golden run output', () => {
  it('standard reproduces its pinned hash and headline metrics', async () => {
    const artifact = await executeRun({ dataset: 'standard', mode: 'rules_only', seed: 42, runId: 'GOLD-STD' });
    const m = artifact.run.metrics!;
    expect(m.output_hash).toBe(GOLDEN.standard!.hash);
    expect(m.precision).toBe(GOLDEN.standard!.precision);
    expect(m.recall).toBe(GOLDEN.standard!.recall);
    expect(m.false_match_rate).toBe(GOLDEN.standard!.falseMatchRate);
  });

  it('hard reproduces its pinned hash and headline metrics', async () => {
    const artifact = await executeRun({ dataset: 'hard', mode: 'rules_only', seed: 42, runId: 'GOLD-HARD' });
    const m = artifact.run.metrics!;
    expect(m.output_hash).toBe(GOLDEN.hard!.hash);
    expect(m.precision).toBe(GOLDEN.hard!.precision);
    expect(m.recall).toBe(GOLDEN.hard!.recall);
    expect(m.false_match_rate).toBe(GOLDEN.hard!.falseMatchRate);
  });

  it('both datasets stay inside the calibration bar the spec sets', async () => {
    for (const dataset of ['standard', 'hard'] as const) {
      const artifact = await executeRun({ dataset, mode: 'rules_only', seed: 42, runId: 'GOLD-CAL-' + dataset });
      expect(artifact.run.metrics!.expected_calibration_error).toBeLessThan(0.1);
    }
  });

  it('stage 1 never produces a wrong auto-clear on either dataset', async () => {
    for (const dataset of ['standard', 'hard'] as const) {
      const artifact = await executeRun({ dataset, mode: 'rules_only', seed: 42, runId: 'GOLD-FMR-' + dataset });
      expect(artifact.run.metrics!.false_match_rate).toBeLessThan(0.01);
    }
  });
});
