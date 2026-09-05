import { NextResponse } from 'next/server';
import { readArtifact } from '@/eval/artifacts';
import { executeRun } from '@/run';
import { createAdjudicator } from '@/adjudicator';

export const dynamic = 'force-dynamic';

/**
 * Re-run the same configuration and compare output hashes (BUILD_SPEC 15.2).
 * Nothing is written: this is a read-only proof, not a new run.
 */
export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const original = readArtifact(runId);
  if (!original || !original.run.metrics) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }

  const config = original.run.config;
  const adjudication = createAdjudicator(config.mode);
  const started = Date.now();

  const replay = await executeRun({
    dataset: config.dataset,
    mode: config.mode,
    seed: config.seed,
    runId: runId + '-VERIFY',
    adjudicator: adjudication.adjudicator,
    llmInteractions: adjudication.interactions,
  });

  const expected = original.run.metrics.output_hash;
  const actual = replay.run.metrics?.output_hash ?? '';

  return NextResponse.json({
    run_id: runId,
    identical: expected === actual,
    expected_hash: expected,
    actual_hash: actual,
    elapsed_ms: Date.now() - started,
    matches_compared: original.matches.length,
  });
}
