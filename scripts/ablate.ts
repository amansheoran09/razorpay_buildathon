#!/usr/bin/env tsx
/**
 * CLI: run all three modes over the same dataset and seed.
 *   npm run ablate -- --dataset standard --seed 42
 *
 * The comparison is only persuasive if the baselines are fair, so llm_only is
 * given the best candidate list it can have rather than a deliberately poor one.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeRun } from '../src/run';
import { createAdjudicator } from '../src/adjudicator';
import { stableStringify } from '../src/lib/hash';
import type { DatasetName, RunMode } from '../src/domain/types';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

interface Skipped {
  mode: RunMode;
  reason: string;
}

interface Row {
  mode: RunMode;
  precision: number;
  recall: number;
  f1: number;
  false_match_rate: number;
  auto_clear_rate: number;
  llm_calls: number;
  wall_clock_ms: number;
  estimated_cost_inr: number;
}

async function main(): Promise<void> {
  const dataset = arg('dataset', 'standard') as DatasetName;
  const seed = Number(arg('seed', '42'));
  // All three modes are always attempted. A mode that cannot run is recorded by
  // name with the reason, rather than quietly dropped from the list - a table
  // that is short without saying why invites the reader to assume the worst,
  // and reporting a mode that never called a model as though it had would be
  // worse still.
  const modes: RunMode[] = ['rules_only', 'llm_only', 'hybrid'];
  const rows: Row[] = [];

  const skipped: Skipped[] = [];

  for (const mode of modes) {
    const adjudication = createAdjudicator(mode);
    if (!adjudication.available) {
      skipped.push({ mode, reason: adjudication.unavailableReason ?? 'unavailable' });
      continue;
    }
    const artifact = await executeRun({
      dataset,
      mode,
      seed,
      runId: 'ABL-' + dataset.slice(0, 4).toUpperCase() + '-' + mode.toUpperCase(),
      adjudicator: adjudication.adjudicator,
      llmInteractions: adjudication.interactions,
    });
    const m = artifact.run.metrics!;
    rows.push({
      mode,
      precision: m.precision,
      recall: m.recall,
      f1: m.f1,
      false_match_rate: m.false_match_rate,
      auto_clear_rate: m.auto_clear_rate,
      llm_calls: m.llm_calls,
      wall_clock_ms: m.wall_clock_ms,
      estimated_cost_inr: m.estimated_cost_inr,
    });
  }

  const dir = join(process.cwd(), 'runs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'ablation-' + dataset + '-' + seed + '.json');
  writeFileSync(path, stableStringify({ dataset, seed, rows, skipped }) + '\n', 'utf8');

  console.log('');
  console.log('  Ablation  ' + dataset + '  seed ' + seed);
  console.log('  ' + '-'.repeat(76));
  console.log('  mode          precision  recall     F1         false-match  LLM calls  cost INR');
  for (const r of rows) {
    console.log(
      '  ' + r.mode.padEnd(13) +
      r.precision.toFixed(4).padEnd(11) +
      r.recall.toFixed(4).padEnd(11) +
      r.f1.toFixed(4).padEnd(11) +
      (r.false_match_rate * 100).toFixed(2).padStart(6) + '%     ' +
      String(r.llm_calls).padStart(6) + '     ' +
      r.estimated_cost_inr.toFixed(4).padStart(8),
    );
  }
  if (skipped.length > 0) {
    console.log('');
    console.log('  Not run:');
    for (const entry of skipped) console.log('    ' + entry.mode.padEnd(12) + entry.reason);
  }

  console.log('');
  console.log('  written to runs/ablation-' + dataset + '-' + seed + '.json');
  console.log('');
}

void main();
