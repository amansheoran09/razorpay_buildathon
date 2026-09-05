import { notFound } from 'next/navigation';
import Link from 'next/link';
import { readArtifact } from '@/eval/artifacts';
import { decisionsForMatch } from '@/lib/persist';
import { formatINR, formatVariance } from '@/lib/money';
import { EXCEPTION_DEFINITIONS } from '@/domain/taxonomy';
import { Card, Masthead, SectionTitle, Shell } from '@/app/components/Chrome';
import { ReconciliationStrip } from '@/app/components/ReconciliationStrip';

export const dynamic = 'force-dynamic';

export default async function AuditTrail({ params }: { params: Promise<{ runId: string; id: string }> }) {
  const { runId, id } = await params;
  const artifact = readArtifact(runId);
  if (!artifact) notFound();

  const match = artifact.matches.find((m) => m.match_id === id);
  if (!match) notFound();

  const humanDecisions = decisionsForMatch(id);

  const interaction = artifact.llm_interactions.find((i) => i.match_id === match.match_id);
  const def = match.exception_type ? EXCEPTION_DEFINITIONS[match.exception_type] : null;

  const ledgers = artifact.records.ledger.filter((r) => match.ledger_ids.includes(r.record_id));
  const gateways = artifact.records.gateway.filter((r) => match.gateway_ids.includes(r.record_id));
  const banks = artifact.records.bank.filter((r) => match.bank_ids.includes(r.record_id));

  return (
    <Shell>
      <Masthead runId={runId} active="Exceptions" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <ReconciliationStrip
          ledger={ledgers.length > 0}
          gateway={gateways.length > 0}
          bank={banks.length > 0}
          variancePaise={match.variance_paise}
          amountPaise={match.reconciled_amount_paise}
          size="lg"
        />
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>{match.match_id}</h1>
        <span style={{ color: 'var(--muted)' }}>
          {def ? def.label : 'Cleared'} &middot; {match.tier} &middot; confidence {match.confidence.toFixed(2)} &middot;
          decided by {match.decided_by}
        </span>
        <Link href={'/runs/' + runId + '/queue'} style={{ marginLeft: 'auto' }}>
          Back to the queue
        </Link>
      </div>

      <SectionTitle note="every stage that touched this group, in order">Stage timeline</SectionTitle>
      <Card pad={0}>
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Outcome</th>
              <th>Note</th>
              <th style={{ textAlign: 'right' }}>Candidates</th>
              <th style={{ textAlign: 'right' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {match.stage_log.map((entry, i) => (
              <tr key={i}>
                <td className="mono">{entry.stage}</td>
                <td style={{ color: entry.outcome === 'matched' ? 'var(--sage)' : entry.outcome === 'rejected' ? 'var(--rust)' : 'var(--amber)' }}>
                  {entry.outcome}
                </td>
                <td style={{ color: 'var(--muted)' }}>{entry.note}</td>
                <td className="num">{entry.candidates_considered}</td>
                <td className="num">{entry.duration_ms} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionTitle>Records in this group</SectionTitle>
      <Card pad={0}>
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Source</th>
              <th>Key</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((r) => (
              <tr key={r.record_id}>
                <td className="mono">{r.record_id}</td>
                <td>ledger</td>
                <td className="mono">{r.invoice_no}</td>
                <td className="num">{formatINR(r.gross_amount_paise)}</td>
                <td style={{ color: 'var(--muted)' }}>{r.customer_name} &middot; issued {r.issue_date}</td>
              </tr>
            ))}
            {gateways.map((r) => (
              <tr key={r.record_id}>
                <td className="mono">{r.record_id}</td>
                <td>gateway</td>
                <td className="mono">{r.payment_id}</td>
                <td className="num">{formatINR(r.net_paise)}</td>
                <td style={{ color: 'var(--muted)' }}>
                  {r.method} &middot; fee {formatINR(r.fee_paise)} &middot; {r.settlement_id ?? 'unsettled'}
                </td>
              </tr>
            ))}
            {banks.map((r) => (
              <tr key={r.record_id}>
                <td className="mono">{r.record_id}</td>
                <td>bank</td>
                <td className="mono">{r.reference_no ?? '\u2014'}</td>
                <td className="num">{formatINR(r.amount_paise)}</td>
                <td className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{r.narration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionTitle>Outcome</SectionTitle>
      <Card>
        <div style={{ display: 'flex', gap: 40, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Reconciled amount</div>
            <div className="mono" style={{ fontSize: 15 }}>{formatINR(match.reconciled_amount_paise)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Variance</div>
            <div className="mono" style={{ fontSize: 15 }}>{formatVariance(match.variance_paise)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Status</div>
            <div className="mono" style={{ fontSize: 15 }}>{match.status.replace('_', ' ')}</div>
          </div>
        </div>
        <blockquote style={{ borderLeft: '2px solid var(--rule)', paddingLeft: 12, margin: 0 }}>
          {match.rationale}
        </blockquote>
        <div style={{ marginTop: 14 }}>
          {match.evidence.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid var(--rule)' }}>
              <span style={{ width: 200, fontSize: 12 }}>{item.label}</span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>{item.detail}</span>
              <span className="num" style={{ width: 44, fontSize: 12, color: 'var(--muted)' }}>{item.weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle note={interaction ? 'the exact prompt sent and the exact response received' : 'the model was not consulted for this group'}>
        Model interaction
      </SectionTitle>
      <Card>
        {!interaction ? (
          <div style={{ color: 'var(--muted)' }}>
            This group was resolved by deterministic rules alone. No model call was made.
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 32, marginBottom: 12, fontSize: 12, flexWrap: 'wrap' }}>
              <span className="mono">{interaction.call_id}</span>
              <span style={{ color: 'var(--muted)' }}>prompt hash {interaction.prompt_hash.slice(0, 16)}</span>
              <span style={{ color: 'var(--muted)' }}>{interaction.cached ? 'served from cache' : 'live call'}</span>
              <span style={{ color: interaction.valid ? 'var(--sage)' : 'var(--rust)' }}>
                {interaction.valid ? 'passed validation' : 'rejected: ' + interaction.violation_reason}
              </span>
              <span className="num" style={{ color: 'var(--muted)' }}>
                {interaction.input_tokens} in / {interaction.output_tokens} out
              </span>
            </div>
            <Pre title="System prompt" body={interaction.system} />
            <Pre title="User message" body={interaction.user} />
            <Pre title="Raw response" body={interaction.raw_response || '(empty)'} />
          </div>
        )}
      </Card>

      <SectionTitle note="recorded separately; the agent's own decision above is never overwritten">
        Human decisions
      </SectionTitle>
      <Card pad={0}>
        {humanDecisions.length === 0 ? (
          <div style={{ padding: '24px 20px', color: 'var(--muted)' }}>
            No human has acted on this group yet. The agent&rsquo;s decision above stands on its own.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Reassigned to</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {humanDecisions.map((decision) => (
                <tr key={decision.decision_id}>
                  <td className="mono" style={{ fontSize: 12 }}>{decision.decided_at.replace('T', ' ').slice(0, 19)}</td>
                  <td
                    style={{
                      color:
                        decision.action === 'approve'
                          ? 'var(--sage)'
                          : decision.action === 'reject'
                            ? 'var(--rust)'
                            : 'var(--amber)',
                    }}
                  >
                    {decision.action}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{decision.reassigned_candidate_id ?? '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{decision.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  );
}

function Pre({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {title}
      </div>
      <pre
        className="mono"
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          padding: 12,
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 380,
          overflowY: 'auto',
        }}
      >
        {body}
      </pre>
    </div>
  );
}
