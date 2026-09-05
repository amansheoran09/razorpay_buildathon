import { notFound } from 'next/navigation';
import Link from 'next/link';
import { readArtifact, readRunIndex } from '@/eval/artifacts';
import { formatINR } from '@/lib/money';
import { EXCEPTION_DEFINITIONS } from '@/domain/taxonomy';
import { Card, Masthead, SectionTitle, Shell } from '@/app/components/Chrome';

export const dynamic = 'force-dynamic';

const LIMITATIONS = [
  'The data is synthetic. Nothing here has been tested against a real bank statement, and real narrations are messier in ways we have not modelled.',
  'Single currency only. Every amount is INR; there is no FX, no conversion date, no revaluation.',
  'No carry-forward across periods. A payment that settles after the period end is reported as an exception rather than moved into the next month.',
  'Subset-sum is capped at 8 members on the standard dataset and 12 on the hard one. A settlement bundling more than that will not be resolved automatically.',
  'Netting across multiple settlement accounts is not handled. One merchant, one bank account.',
  'A settlement is treated as atomic. A gateway that splits one batch across two payouts would defeat the combinatorial stage.',
  'Human decisions are recorded but do not feed back into matching. Nothing learns from a reassignment yet.',
];

export default async function Honesty({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const artifact = readArtifact(runId);
  if (!artifact || !artifact.run.metrics) notFound();

  const m = artifact.run.metrics;
  const c = artifact.run.config;
  const { false_positives: wrong, false_negatives: missed, correctly_declined: declined } = artifact.failures;
  const resolvableMissed = missed.filter((f) => f.reason !== 'Genuinely undecidable.');

  const counterpart = readRunIndex().find(
    (r) => r.dataset !== c.dataset && r.mode === c.mode && r.seed === c.seed,
  );

  return (
    <Shell>
      <Masthead runId={runId} active="Honesty report" />

      <p style={{ maxWidth: 760, fontSize: 15, marginBottom: 8 }}>
        {wrong.length === 0
          ? 'No match in this run was wrong. ' + resolvableMissed.length + ' groups were not reconciled at all and are listed below.'
          : wrong.length + ' matches were wrong. Here they are, largest first.'}
      </p>
      <p style={{ maxWidth: 760, color: 'var(--muted)', marginBottom: 4 }}>
        Every number on this page is recomputed from the committed run artifact. A reconciliation tool
        that hides its failure rate is worse than no tool, so this page leads with the failures rather
        than burying them.
      </p>

      <SectionTitle note={wrong.length + ' groups the system asserted incorrectly'}>What we got wrong</SectionTitle>
      <Card pad={0}>
        {wrong.length === 0 ? (
          <div style={{ padding: '28px 20px', color: 'var(--sage)' }}>
            Nothing. Every group the system asserted matched ground truth exactly.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Match</th>
                <th style={{ textAlign: 'right' }}>Amount at risk</th>
                <th style={{ textAlign: 'right' }}>Confidence</th>
                <th>Tier</th>
                <th>Proposed</th>
                <th>True group</th>
                <th>Why it was fooled</th>
              </tr>
            </thead>
            <tbody>
              {wrong.slice(0, 60).map((f) => (
                <tr key={f.match_id}>
                  <td>
                    <Link className="mono" href={'/runs/' + runId + '/record/' + f.match_id}>
                      {f.match_id}
                    </Link>
                  </td>
                  <td className="num">{formatINR(f.amount_at_risk_paise)}</td>
                  <td className="num">{f.confidence.toFixed(2)}</td>
                  <td>{f.tier}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{f.proposed_ids.join(' ')}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{f.true_ids ? f.true_ids.join(' ') : '\u2014'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 380 }}>{f.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SectionTitle note={resolvableMissed.length + ' groups with a correct answer the system did not reach'}>
        What we missed
      </SectionTitle>
      <Card pad={0}>
        {resolvableMissed.length === 0 ? (
          <div style={{ padding: '28px 20px', color: 'var(--sage)' }}>Nothing resolvable was missed.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Truth group</th>
                <th>Scenario</th>
                <th>Exception</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Records</th>
                <th>Why it was not caught</th>
              </tr>
            </thead>
            <tbody>
              {resolvableMissed.slice(0, 60).map((f) => (
                <tr key={f.truth_id}>
                  <td className="mono">{f.truth_id}</td>
                  <td>{f.scenario.replace(/_/g, ' ')}</td>
                  <td>{f.exception_type ? EXCEPTION_DEFINITIONS[f.exception_type].label : 'Clean'}</td>
                  <td className="num">{formatINR(f.amount_paise)}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{f.record_ids.join(' ')}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SectionTitle note="groups where no correct automated answer exists">What we could not decide</SectionTitle>
      <Card pad={0}>
        {declined.length === 0 ? (
          <div style={{ padding: '28px 20px', color: 'var(--muted)' }}>
            This dataset contains no groups marked undecidable. The hard dataset does.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Truth group</th>
                <th>Scenario</th>
                <th>Records</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {declined.map((d) => (
                <tr key={d.truth_id}>
                  <td className="mono">{d.truth_id}</td>
                  <td>{d.scenario.replace(/_/g, ' ')}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{d.record_ids.join(' ')}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SectionTitle note="the same system, measured two ways">This run against the other dataset</SectionTitle>
      <Card>
        <table>
          <thead>
            <tr>
              <th>Dataset</th>
              <th style={{ textAlign: 'right' }}>Auto-clear</th>
              <th style={{ textAlign: 'right' }}>False-match</th>
              <th style={{ textAlign: 'right' }}>Precision</th>
              <th style={{ textAlign: 'right' }}>Recall</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{c.dataset} (this run)</td>
              <td className="num">{(m.auto_clear_rate * 100).toFixed(1)}%</td>
              <td className="num">{(m.false_match_rate * 100).toFixed(2)}%</td>
              <td className="num">{m.precision.toFixed(4)}</td>
              <td className="num">{m.recall.toFixed(4)}</td>
            </tr>
            {counterpart ? (
              <tr>
                <td>
                  <Link href={'/runs/' + counterpart.run_id + '/honesty'}>{counterpart.dataset}</Link>
                </td>
                <td className="num">{(counterpart.auto_clear_rate * 100).toFixed(1)}%</td>
                <td className="num">{(counterpart.false_match_rate * 100).toFixed(2)}%</td>
                <td className="num">{counterpart.precision.toFixed(4)}</td>
                <td className="num">{counterpart.recall.toFixed(4)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 12, maxWidth: 720 }}>
          The hard dataset drops clean records to 30%, bundles up to eight invoices into one credit,
          corrupts 40% of all bank narrations regardless of scenario, and marks 3% of groups genuinely
          undecidable. The system was not tuned against it.
        </p>
      </Card>

      <SectionTitle>Known limitations</SectionTitle>
      <Card>
        <ul style={{ paddingLeft: 18, maxWidth: 820 }}>
          {LIMITATIONS.map((line) => (
            <li key={line} style={{ marginBottom: 8, color: 'var(--muted)' }}>
              {line}
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
