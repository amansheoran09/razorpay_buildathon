import { notFound } from 'next/navigation';
import { readArtifact } from '@/eval/artifacts';
import { buildQueue } from '@/eval/queue-model';
import { formatINR } from '@/lib/money';
import { Masthead, Shell } from '@/app/components/Chrome';
import { ExceptionQueue } from '@/app/components/ExceptionQueue';

export const dynamic = 'force-dynamic';

export default async function QueuePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const artifact = readArtifact(runId);
  if (!artifact) notFound();

  // Only what the queue actually renders crosses to the client.
  const items = buildQueue(artifact);
  const atRisk = items.reduce((total, item) => total + item.amount_paise, 0);

  return (
    <Shell>
      <Masthead runId={runId} active="Exceptions" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>Exception queue</h1>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          {items.length} items the agent would not clear on its own, holding{' '}
          <span className="mono">{formatINR(atRisk)}</span> of exposure. Biggest first.
        </span>
      </div>
      <ExceptionQueue runId={runId} items={items} />
    </Shell>
  );
}
