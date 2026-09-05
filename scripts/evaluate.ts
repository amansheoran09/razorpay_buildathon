#!/usr/bin/env tsx
/**
 * CLI: score a committed run artifact against ground truth.
 *   npm run evaluate -- --run RUN-STAN-RULES-42
 *
 * Metrics are always recomputed from the artifact, never read from the cached
 * metrics field, so the printed numbers cannot drift from the stored matches.
 */

import { readArtifact } from '../src/eval/artifacts';
import { scoreRun } from '../src/eval/metrics';
import { ingestDataset } from '../src/ingest';
import { formatINR } from '../src/lib/money';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

const runId = arg('run', '');
if (!runId) {
  console.error('usage: npm run evaluate -- --run RUN-ID');
  process.exit(1);
}

const artifact = readArtifact(runId);
if (!artifact) {
  console.error('no artifact at runs/' + runId + '.json');
  process.exit(1);
}

const { groundTruth } = ingestDataset(artifact.run.config.dataset);
const score = scoreRun(artifact.matches, groundTruth);
const pct = (v: number): string => (v * 100).toFixed(2) + '%';
const line = (label: string, value: string): void => console.log('  ' + label.padEnd(26) + value.padStart(14));

console.log('');
console.log('  ' + runId + '  recomputed from the artifact');
console.log('  ' + '-'.repeat(40));
line('True positives', String(score.true_positives));
line('False positives', String(score.false_positives));
line('False negatives', String(score.false_negatives));
line('Precision', score.precision.toFixed(4));
line('Recall', score.recall.toFixed(4));
line('F1', score.f1.toFixed(4));
line('False-match rate', pct(score.false_match_rate));
line('Auto-clear rate', pct(score.auto_clear_rate));
line('Escalation precision', pct(score.escalation_precision));
line('Declined to guess', String(score.declined));
line('Calibration error', score.expected_calibration_error.toFixed(4));
console.log('');
console.log('  Calibration');
for (const b of score.calibration_buckets) {
  console.log(
    '    ' + b.lower.toFixed(1) + '-' + b.upper.toFixed(1) +
    '  n=' + String(b.count).padStart(4) +
    '  stated ' + b.stated_confidence_mean.toFixed(3) +
    '  actual ' + b.actual_accuracy.toFixed(3),
  );
}
console.log('');
console.log('  Largest wrong matches');
for (const fp of score.failures.false_positives.slice(0, 5)) {
  console.log('    ' + fp.match_id + '  ' + formatINR(fp.amount_at_risk_paise).padStart(16) + '  ' + fp.explanation.slice(0, 90));
}
console.log('');
