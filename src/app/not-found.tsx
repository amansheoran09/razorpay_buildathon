import Link from 'next/link';
import { readRunIndex } from '@/eval/artifacts';
import { Card, Masthead, Shell } from './components/Chrome';

export const dynamic = 'force-dynamic';

/**
 * Errors state what happened and what to do, and do not apologise
 * (BUILD_SPEC section 16). A dead end here means a run id that is not on disk,
 * so the useful thing to show is the runs that are.
 */
export default function NotFound() {
  const runs = readRunIndex().slice().reverse();

  return (
    <Shell>
      <Masthead />
      <Card>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>That run is not here</h1>
        <p style={{ color: 'var(--muted)', maxWidth: 620, marginBottom: 20 }}>
          Nothing on disk matches that address. Either the run has not been reconciled yet, or the id
          is wrong. Reconcile one with{' '}
          <span className="mono">npm run reconcile -- --dataset standard --mode rules_only</span>, or
          pick one below.
        </p>

        {runs.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            There are no committed runs yet. Start one from the{' '}
            <Link href="/">dashboard</Link>.
          </p>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              {runs.length} run{runs.length === 1 ? '' : 's'} on disk
            </div>
            {runs.map((run) => (
              <div key={run.run_id} style={{ display: 'flex', gap: 16, padding: '5px 0', alignItems: 'baseline' }}>
                <Link className="mono" href={'/runs/' + run.run_id} style={{ width: 200 }}>
                  {run.run_id}
                </Link>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {run.dataset} &middot; {run.mode.replace('_', ' ')} &middot; seed {run.seed}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
