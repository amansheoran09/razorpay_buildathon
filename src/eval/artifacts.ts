/** Run artifact index (BUILD_SPEC section 12). */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stableStringify } from '../lib/hash';
import type { RunArtifact } from '../domain/types';

export interface RunIndexEntry {
  run_id: string;
  dataset: string;
  mode: string;
  seed: number;
  started_at: string;
  match_groups: number;
  auto_clear_rate: number;
  false_match_rate: number;
  precision: number;
  recall: number;
  records_per_second: number;
  wall_clock_ms: number;
  output_hash: string;
}

export function runsDir(root = process.cwd()): string {
  return join(root, 'runs');
}

export function indexPath(root = process.cwd()): string {
  return join(runsDir(root), 'index.json');
}

export function readRunIndex(root = process.cwd()): RunIndexEntry[] {
  const path = indexPath(root);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RunIndexEntry[];
  } catch {
    return [];
  }
}

export function appendRunIndex(artifact: RunArtifact, root = process.cwd()): void {
  const m = artifact.run.metrics;
  if (!m) return;
  mkdirSync(runsDir(root), { recursive: true });
  const entry: RunIndexEntry = {
    run_id: artifact.run.run_id,
    dataset: artifact.run.config.dataset,
    mode: artifact.run.config.mode,
    seed: artifact.run.config.seed,
    started_at: artifact.run.started_at,
    match_groups: m.match_groups,
    auto_clear_rate: m.auto_clear_rate,
    false_match_rate: m.false_match_rate,
    precision: m.precision,
    recall: m.recall,
    records_per_second: m.records_per_second,
    wall_clock_ms: m.wall_clock_ms,
    output_hash: m.output_hash,
  };
  const existing = readRunIndex(root).filter((e) => e.run_id !== entry.run_id);
  existing.push(entry);
  existing.sort((a, b) => (a.run_id < b.run_id ? -1 : 1));
  writeFileSync(indexPath(root), stableStringify(existing) + '\n', 'utf8');
}

export function readArtifact(runId: string, root = process.cwd()): RunArtifact | null {
  const path = join(runsDir(root), runId + '.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as RunArtifact;
}
