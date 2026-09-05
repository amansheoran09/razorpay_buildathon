/** Terminal rendering of run metrics. */

import { formatINR } from '../lib/money';
import { shortHash } from '../lib/hash';
import type { RunArtifact } from '../domain/types';

const pct = (v: number): string => (v * 100).toFixed(1) + '%';

function row(label: string, value: string): string {
  return '  ' + label.padEnd(28) + value.padStart(14);
}

export function renderReport(artifact: RunArtifact): string {
  const m = artifact.run.metrics;
  if (!m) return 'Run has no metrics.';
  const c = artifact.run.config;
  const lines: string[] = [];

  lines.push('');
  lines.push('  ' + artifact.run.run_id + '   ' + c.dataset + ' / ' + c.mode + ' / seed ' + c.seed);
  lines.push('  ' + '-'.repeat(42));
  lines.push(row('Records', String(m.total_records)));
  lines.push(row('Match groups', String(m.match_groups)));
  lines.push('');
  lines.push(row('Auto-cleared', m.auto_cleared + '  ' + pct(m.auto_clear_rate)));
  lines.push(row('False-match rate', pct(m.false_match_rate)));
  lines.push(row('Throughput', m.records_per_second.toFixed(1) + ' rec/s'));
  lines.push(row('Cost per record', m.cost_per_record_inr.toFixed(4) + ' INR'));
  lines.push('');
  lines.push(row('Precision', m.precision.toFixed(4)));
  lines.push(row('Recall', m.recall.toFixed(4)));
  lines.push(row('F1', m.f1.toFixed(4)));
  lines.push(row('Escalation precision', m.escalation_precision.toFixed(4)));
  lines.push(row('True / false positives', m.true_positives + ' / ' + m.false_positives));
  lines.push(row('False negatives', String(m.false_negatives)));
  lines.push('');
  lines.push(row('LLM calls', String(m.llm_calls)));
  lines.push(row('LLM calls per 100 rec', m.llm_calls_per_100_records.toFixed(2)));
  lines.push(row('Schema violations', String(m.llm_schema_violations)));
  lines.push(row('Cache hits', String(m.llm_cache_hits)));
  lines.push(row('Estimated cost', formatINR(Math.round(m.estimated_cost_inr * 100))));
  lines.push('');
  lines.push(row('Wall clock', m.wall_clock_ms + ' ms'));
  lines.push(row('Ingest warnings', String(m.ingest_warnings)));
  lines.push(row('Calibration error', m.expected_calibration_error.toFixed(4)));
  lines.push(row('Output hash', shortHash(m.output_hash)));
  lines.push('');
  lines.push('  Stage coverage');
  for (const [stage, count] of Object.entries(m.stage_coverage)) {
    lines.push(row('  ' + stage, String(count)));
  }
  lines.push('');
  lines.push('  Category recall');
  const cats = Object.entries(m.category_recall)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total);
  for (const [name, v] of cats) {
    lines.push('  ' + name.padEnd(24) + String(v.caught).padStart(4) + ' / ' + String(v.total).padEnd(5) + pct(v.recall).padStart(7));
  }
  lines.push('');
  return lines.join('\n');
}
