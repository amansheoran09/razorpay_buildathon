import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { HumanDecisionSchema } from '@/domain/schema';

export const dynamic = 'force-dynamic';

/**
 * A human decision is recorded alongside the agent's decision, never over it.
 * The audit trail has to show both, so nothing here mutates the run artifact.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = HumanDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid decision.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const runId = url.searchParams.get('run') ?? '';
  const decisionId = randomUUID();

  getDb()
    .prepare(
      'INSERT INTO human_decisions (decision_id, run_id, match_id, action, reassigned_candidate_id, note, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      decisionId,
      runId,
      id,
      parsed.data.action,
      parsed.data.reassigned_candidate_id ?? null,
      parsed.data.note ?? null,
      new Date().toISOString(),
    );

  return NextResponse.json({ decision_id: decisionId, match_id: id, action: parsed.data.action });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const rows = getDb()
    .prepare('SELECT * FROM human_decisions WHERE match_id = ? ORDER BY decided_at')
    .all(id);
  return NextResponse.json({ decisions: rows });
}
