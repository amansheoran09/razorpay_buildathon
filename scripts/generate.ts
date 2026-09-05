#!/usr/bin/env tsx
/**
 * CLI: build datasets.
 *   npm run generate -- --dataset standard --seed 42 --count 500
 *   npm run generate -- --all
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../src/generator';
import { stableStringify } from '../src/lib/hash';
import type { DatasetName } from '../src/domain/types';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

function flag(name: string): boolean {
  return process.argv.includes('--' + name);
}

function run(dataset: DatasetName, seed: number, count: number): void {
  const result = generate({ dataset, seed, count });
  const dir = join(process.cwd(), 'data', 'generated', dataset);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'ledger.csv'), result.ledgerCsv, 'utf8');
  writeFileSync(join(dir, 'gateway.csv'), result.gatewayCsv, 'utf8');
  writeFileSync(join(dir, 'bank.csv'), result.bankCsv, 'utf8');
  writeFileSync(join(dir, 'ground_truth.json'), stableStringify(result.groundTruth) + '\n', 'utf8');

  const total = result.counts.ledger + result.counts.gateway + result.counts.bank;
  console.log('');
  console.log('  ' + dataset + '  seed ' + seed + '  groups ' + result.counts.groups);
  console.log('  ledger ' + result.counts.ledger + '   gateway ' + result.counts.gateway + '   bank ' + result.counts.bank + '   total ' + total);
  console.log('  written to data/generated/' + dataset + '/');

  const mix = Object.entries(result.scenarioCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => '    ' + k.padEnd(20) + String(v).padStart(4) + '  ' + ((v / count) * 100).toFixed(1) + '%')
    .join('\n');
  console.log('  scenario mix:');
  console.log(mix);
}

const seed = Number(arg('seed', '42'));
const count = Number(arg('count', '500'));

if (flag('all')) {
  run('standard', seed, count);
  run('hard', seed, count);
} else {
  run(arg('dataset', 'standard') as DatasetName, seed, count);
}
console.log('');
