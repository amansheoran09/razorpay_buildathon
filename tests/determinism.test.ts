import { describe, expect, it } from 'vitest';
import { executeRun } from '../src/run';
import { generate } from '../src/generator';
import { hashObject, stableStringify } from '../src/lib/hash';

describe('stable hashing', () => {
  it('ignores object key order', () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
    expect(hashObject({ x: { p: 1, q: 2 } })).toBe(hashObject({ x: { q: 2, p: 1 } }));
  });

  it('does not ignore array order', () => {
    expect(hashObject([1, 2])).not.toBe(hashObject([2, 1]));
  });

  it('collapses negative zero', () => {
    expect(stableStringify({ v: -0 })).toBe(stableStringify({ v: 0 }));
  });

  it('distinguishes genuinely different content', () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });
});

describe('run determinism', () => {
  it('produces an identical output hash across two runs', async () => {
    const first = await executeRun({ dataset: 'standard', mode: 'rules_only', seed: 42, runId: 'DET-1' });
    const second = await executeRun({ dataset: 'standard', mode: 'rules_only', seed: 42, runId: 'DET-2' });
    expect(second.run.metrics?.output_hash).toBe(first.run.metrics?.output_hash);
  });

  it('produces identical match content across two runs', async () => {
    const first = await executeRun({ dataset: 'standard', mode: 'rules_only', seed: 42, runId: 'DET-3' });
    const second = await executeRun({ dataset: 'standard', mode: 'rules_only', seed: 42, runId: 'DET-4' });
    const strip = (m: (typeof first.matches)[number]) => ({
      tier: m.tier,
      status: m.status,
      confidence: m.confidence,
      ledger_ids: m.ledger_ids,
      gateway_ids: m.gateway_ids,
      bank_ids: m.bank_ids,
      exception_type: m.exception_type,
      rationale: m.rationale,
    });
    expect(second.matches.map(strip)).toEqual(first.matches.map(strip));
  });

  it('produces identical metrics across two runs', async () => {
    const first = await executeRun({ dataset: 'standard', mode: 'rules_only', seed: 42, runId: 'DET-5' });
    const second = await executeRun({ dataset: 'standard', mode: 'rules_only', seed: 42, runId: 'DET-6' });
    const strip = (m: NonNullable<typeof first.run.metrics>) => {
      const { wall_clock_ms, records_per_second, ...rest } = m;
      void wall_clock_ms;
      void records_per_second;
      return rest;
    };
    expect(strip(second.run.metrics!)).toEqual(strip(first.run.metrics!));
  });

  it('regenerating the dataset under the same seed changes nothing', () => {
    const a = generate({ dataset: 'standard', seed: 42, count: 500 });
    const b = generate({ dataset: 'standard', seed: 42, count: 500 });
    expect(hashObject(a.groundTruth)).toBe(hashObject(b.groundTruth));
    expect(a.bankCsv).toBe(b.bankCsv);
  });
});

describe('the engine never imports the generator', () => {
  it('keeps the firewall that makes the accuracy claim meaningful', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
      });

    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), 'src', 'engine'))) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.startsWith('import')) continue;
        if (!line.includes('generator')) continue;
        // world.ts holds shared business constants (fee bands), not scenarios.
        if (line.includes("generator/world")) continue;
        offenders.push(file + ': ' + line.trim());
      }
    }
    expect(offenders).toEqual([]);
  });
});
