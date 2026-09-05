import { notFound } from 'next/navigation';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readArtifact } from '@/eval/artifacts';
import { formatINR } from '@/lib/money';
import { shortHash } from '@/lib/hash';
import { Card, Figure, Masthead, SectionTitle, Shell } from '@/app/components/Chrome';
import { CalibrationChart, CategoryBreakdown } from '@/app/components/Charts';
import { VerifyDeterminism } from '@/app/components/VerifyDeterminism';

export const dynamic = 'force-dynamic';

interface AblationSkip {
  mode: string;
  reason: string;
}

interface AblationRow {
  mode: string;
  precision: number;
  recall: number;
  f1: number;
  false_match_rate: number;
  auto_clear_rate: number;
  llm_calls: number;
  wall_clock_ms: number;
  estimated_cost_inr: number;
}

function readAblation(
  dataset: string,
  seed: number,
): { rows: AblationRow[]; skipped: AblationSkip[] } | null {
  const path = join(process.cwd(), 'runs', 'ablation-' + dataset + '-' + seed + '.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { rows: AblationRow[]; skipped?: AblationSkip[] };
    return { rows: parsed.rows, skipped: parsed.skipped ?? [] };
  } catch {
    return null;
  }
}

export default async function Scorecard({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const artifact = readArtifact(runId);
  if (!artifact || !artifact.run.metrics) notFound();

  const m = artifact.run.metrics;
  const c = artifact.run.config;
  const ablation = readAblation(c.dataset, c.seed);

  const categories = Object.entries(m.category_recall)
    .filter((entry) => entry[1].total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .map((entry) => ({ name: entry[0], total: entry[1].total, caught: entry[1].caught, recall: entry[1].recall }));

  return (
    <Shell>
      <Masthead runId={runId} active="Scorecard" />

      <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
        <Figure label="Auto-cleared" value={String(m.auto_cleared)} sub={(m.auto_clear_rate * 100).toFixed(1) + '% of groups'} />
        <Figure
          label="False-match rate"
          value={(m.false_match_rate * 100).toFixed(2) + '%'}
          sub="incorrect auto-clears over all auto-clears"
          dominant
          tone={m.false_match_rate > 0.01 ? 'var(--rust)' : 'var(--sage)'}
        />
        <Figure label="Throughput" value={m.records_per_second.toFixed(1)} sub="records per second" />
        <Figure label="Cost per record" value={(m.cost_per_record_inr * 100).toFixed(2)} sub="paise" />
      </div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
        <Figure label="Precision" value={m.precision.toFixed(4)} />
        <Figure label="Recall" value={m.recall.toFixed(4)} />
        <Figure label="F1" value={m.f1.toFixed(4)} />
        <Figure label="Escalation precision" value={m.escalation_precision.toFixed(4)} sub="escalations that were real exceptions" />
        <Figure label="LLM calls" value={String(m.llm_calls)} sub={m.llm_calls_per_100_records.toFixed(2) + ' per 100 records'} />
        <Figure
          label="Schema violations"
          value={String(m.llm_schema_violations)}
          sub="rejected and escalated"
          tone={m.llm_schema_violations > 0 ? 'var(--amber)' : undefined}
        />
        <Figure label="Cache hits" value={String(m.llm_cache_hits)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 24, marginTop: 24 }}>
        <div>
          <SectionTitle note="generated versus caught, by exception type">Category breakdown</SectionTitle>
          <Card>
            <CategoryBreakdown rows={categories} />
          </Card>
        </div>
        <div>
          <SectionTitle note="stated confidence against observed accuracy">Calibration</SectionTitle>
          <Card>
            <CalibrationChart buckets={m.calibration_buckets} ece={m.expected_calibration_error} />
          </Card>
        </div>
      </div>

      <SectionTitle note={ablation ? 'same dataset, same seed, three modes' : 'run npm run ablate to populate this'}>
        Ablation
      </SectionTitle>
      <Card pad={0}>
        {ablation && ablation.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Mode</th>
                <th style={{ textAlign: 'right' }}>Precision</th>
                <th style={{ textAlign: 'right' }}>Recall</th>
                <th style={{ textAlign: 'right' }}>F1</th>
                <th style={{ textAlign: 'right' }}>False-match</th>
                <th style={{ textAlign: 'right' }}>Auto-clear</th>
                <th style={{ textAlign: 'right' }}>LLM calls</th>
                <th style={{ textAlign: 'right' }}>Wall clock</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {ablation.rows.map((row) => (
                <tr key={row.mode}>
                  <td>{row.mode.replace('_', ' ')}</td>
                  <td className="num">{row.precision.toFixed(4)}</td>
                  <td className="num">{row.recall.toFixed(4)}</td>
                  <td className="num">{row.f1.toFixed(4)}</td>
                  <td className="num">{(row.false_match_rate * 100).toFixed(2)}%</td>
                  <td className="num">{(row.auto_clear_rate * 100).toFixed(1)}%</td>
                  <td className="num">{row.llm_calls}</td>
                  <td className="num">{row.wall_clock_ms} ms</td>
                  <td className="num">{formatINR(Math.round(row.estimated_cost_inr * 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '28px 20px', color: 'var(--muted)' }}>
            No ablation for {c.dataset} seed {c.seed} yet. Run the ablate script to produce it.
          </div>
        )}

        {ablation && ablation.skipped.length > 0 ? (
          <div style={{ borderTop: '1px solid var(--rule)', padding: '14px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>
              {ablation.skipped.length} of 3 modes did not run
            </div>
            {ablation.skipped.map((entry) => (
              <div key={entry.mode} style={{ display: 'flex', gap: 12, fontSize: 12, padding: '2px 0' }}>
                <span className="mono" style={{ width: 92 }}>{entry.mode}</span>
                <span style={{ color: 'var(--muted)' }}>{entry.reason}</span>
              </div>
            ))}
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, maxWidth: 720 }}>
              The table above is a baseline, not a comparison. It is shown short rather than filled
              with a run that never called the model.
            </div>
          </div>
        ) : null}
      </Card>

      <SectionTitle>Run configuration</SectionTitle>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 40px' }}>
          {[
            ['dataset', c.dataset],
            ['mode', c.mode],
            ['seed', String(c.seed)],
            ['auto-clear threshold', c.auto_clear_threshold.toFixed(2)],
            ['amount tolerance', c.amount_tolerance_paise + ' paise'],
            ['date window', c.date_window_days + ' days'],
            ['max candidates', String(c.max_candidates)],
            ['model', c.llm_model],
            ['records', String(m.total_records)],
            ['ingest warnings', String(m.ingest_warnings)],
            ['wall clock', m.wall_clock_ms + ' ms'],
            ['output hash', shortHash(m.output_hash, 16)],
          ].map((entry) => (
            <div key={entry[0]}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{entry[0]}</div>
              <div className="mono" style={{ fontSize: 13 }}>{entry[1]}</div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 16, color: 'var(--muted)', fontSize: 12, maxWidth: 720 }}>
          The output hash covers every match decision in this run. Re-running with the same seed and
          configuration produces the same hash, which is what makes these numbers checkable rather
          than merely reported.
        </p>
        <VerifyDeterminism runId={artifact.run.run_id} />
      </Card>
    </Shell>
  );
}
