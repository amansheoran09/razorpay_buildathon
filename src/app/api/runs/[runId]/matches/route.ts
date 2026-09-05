import { NextResponse } from 'next/server';
import { queryMatches, runExists } from '@/lib/persist';

export const dynamic = 'force-dynamic';

/** BUILD_SPEC section 14: status, exception_type, min_confidence, sort, cursor. */
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const params = new URL(request.url).searchParams;

  const minConfidence = params.get('min_confidence');
  const cursor = params.get('cursor');
  const limit = params.get('limit');

  // An unknown run and a run with no matching rows both come back empty from
  // SQLite. A caller has to be able to tell those apart, so the run is checked
  // before the query rather than inferred from an empty result.
  if (!runExists(runId)) {
    return NextResponse.json(
      { error: 'No run ' + runId + ' in the database. Reconcile it first, or check the id.' },
      { status: 404 },
    );
  }

  try {
    const result = queryMatches(runId, {
      status: params.get('status') ?? undefined,
      exception_type: params.get('exception_type') ?? undefined,
      min_confidence: minConfidence === null ? undefined : Number(minConfidence),
      sort: (params.get('sort') as 'amount' | 'confidence' | 'variance' | null) ?? undefined,
      cursor: cursor === null ? undefined : Number(cursor),
      limit: limit === null ? undefined : Number(limit),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Run not found in the database. Re-run it to populate.' }, { status: 404 });
  }
}
