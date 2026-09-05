import { NextResponse } from 'next/server';
import { readArtifact } from '@/eval/artifacts';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const artifact = readArtifact(runId);
  if (!artifact) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  return NextResponse.json(artifact);
}
