#!/usr/bin/env tsx
/**
 * One command for a cold start: generate both datasets, reconcile both, run the
 * ablation, then hand over to the interface.
 */

import { spawnSync } from 'node:child_process';

function run(label: string, args: string[]): void {
  console.log('');
  console.log('  \u2192 ' + label);
  const result = spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error('  failed: ' + label);
    process.exit(result.status ?? 1);
  }
}

run('generating both datasets', ['scripts/generate.ts', '--all', '--seed', '42', '--count', '500']);
run('reconciling standard', ['scripts/reconcile.ts', '--dataset', 'standard', '--mode', 'rules_only']);
run('reconciling hard', ['scripts/reconcile.ts', '--dataset', 'hard', '--mode', 'rules_only']);
run('ablation on standard', ['scripts/ablate.ts', '--dataset', 'standard', '--seed', '42']);
run('ablation on hard', ['scripts/ablate.ts', '--dataset', 'hard', '--seed', '42']);

console.log('');
console.log('  Artifacts are in runs/. Starting the interface on http://localhost:3000');
console.log('');
spawnSync('npm', ['run', 'dev'], { stdio: 'inherit', shell: true });
