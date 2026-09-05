import { NextResponse } from 'next/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeRun } from '@/run';
import { createAdjudicator } from '@/adjudicator';
import { appendRunIndex, readRunIndex } from '@/eval/artifacts';
import { persistRun } from '@/lib/persist';
import { stableStringify } from '@/lib/hash';
import { RunConfigSchema } from '@/domain/schema';
import { recordProgress, finishProgress } from './progress';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ runs: readRunIndex() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RunConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid run configuration.' }, { status: 400 });
  }

  const { dataset, mode, seed } = parsed.data;
  const runId =
    'RUN-' + dataset.slice(0, 4).toUpperCase() + '-' + mode.slice(0, 5).toUpperCase() + '-' + seed;

  // Refuse a mode whose stage 4 cannot run, rather than producing an artifact
  // labelled hybrid that never called the model.
  const probe = createAdjudicator(mode);
  if (!probe.available) {
    return NextResponse.json({ error: probe.unavailableReason }, { status: 409 });
  }

  // Kick the run off and return immediately; the client follows the SSE stream.
  void (async () => {
    try {
      const adjudication = createAdjudicator(mode);
      const artifact = await executeRun({
        dataset,
        mode,
        seed,
        runId,
        adjudicator: adjudication.adjudicator,
        llmInteractions: adjudication.interactions,
        onProgress: (event) => recordProgress(runId, event),
      });
      const dir = join(process.cwd(), 'runs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, runId + '.json'), stableStringify(artifact) + '\n', 'utf8');
      appendRunIndex(artifact);
      persistRun(artifact);
      finishProgress(runId, null);
    } catch (error) {
      finishProgress(runId, String(error));
    }
  })();

  return NextResponse.json({ run_id: runId, status: 'running' });
}
