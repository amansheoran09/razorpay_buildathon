import { NextResponse } from 'next/server';
import { decisionsForRun } from '@/lib/persist';

export const dynamic = 'force-dynamic';

/** Every human decision recorded against this run, for the queue to rehydrate. */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  return NextResponse.json({ decisions: decisionsForRun(runId) });
}
