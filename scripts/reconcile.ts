#!/usr/bin/env tsx
/**
 * CLI: run a reconciliation.
 *   npm run reconcile -- --dataset standard --mode rules_only
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeRun } from '../src/run';
import { renderReport } from '../src/eval/report';
import { stableStringify } from '../src/lib/hash';
import { createAdjudicator } from '../src/adjudicator';
import { appendRunIndex } from '../src/eval/artifacts';
import { persistRun } from '../src/lib/persist';
import type { DatasetName, RunMode } from '../src/domain/types';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

async function main(): Promise<void> {
  const dataset = arg('dataset', 'standard') as DatasetName;
  const mode = arg('mode', 'hybrid') as RunMode;
  const seed = Number(arg('seed', '42'));
  const runId = arg('run', 'RUN-' + dataset.slice(0, 4).toUpperCase() + '-' + mode.slice(0, 5).toUpperCase() + '-' + seed);

  const adjudication = createAdjudicator(mode);

  // A run labelled hybrid or llm_only that never called the model is not that
  // run. Writing it would put a meaningless artifact in runs/ under a name that
  // claims otherwise, so it is refused instead.
  if (!adjudication.available) {
    console.error('');
    console.error('  Cannot run mode "' + mode + '".');
    console.error('  ' + adjudication.unavailableReason);
    console.error('');
    console.error('  Put a key in .env.local, or run --mode rules_only.');
    console.error('');
    process.exit(2);
  }

  const artifact = await executeRun({
    dataset,
    mode,
    seed,
    runId,
    adjudicator: adjudication.adjudicator,
    llmInteractions: adjudication.interactions,
  });

  console.log(renderReport(artifact));

  const dir = join(process.cwd(), 'runs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, runId + '.json'), stableStringify(artifact) + '\n', 'utf8');
  appendRunIndex(artifact);
  persistRun(artifact);
  console.log('  artifact written to runs/' + runId + '.json');
  console.log('');
}

void main();
