import Link from 'next/link';
import { loadConfig } from '@/lib/config';
import { readRunIndex } from '@/eval/artifacts';
import { shortHash } from '@/lib/hash';
import { Card, Empty, Masthead, SectionTitle, Shell } from './components/Chrome';
import { RunLauncher } from './components/RunLauncher';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const cfg = loadConfig();
  const runs = readRunIndex().slice().reverse();

  const knobs = [
    { label: 'Auto-clear threshold', value: cfg.autoClearThreshold.toFixed(2), note: 'confidence at or above this clears' },
    { label: 'Amount tolerance', value: cfg.amountTolerancePaise + ' paise', note: 'per match' },
    { label: 'Date window', value: cfg.dateWindowDays + ' days', note: 'capture to value date' },
    { label: 'Max candidates', value: String(cfg.maxCandidates), note: 'shown to the model' },
    { label: 'Model', value: cfg.llmModel, note: cfg.apiKeyPresent ? 'API key present' : 'no API key - rules only' },
    { label: 'Response cache', value: cfg.llmCache ? 'on' : 'off', note: 'keyed by prompt hash' },
    { label: 'USD to INR', value: String(cfg.usdToInr), note: 'pinned, not fetched' },
  ];

  return (
    <Shell>
      <Masthead />

      <SectionTitle note="every knob the system runs on, and what it is set to">
        Run configuration
      </SectionTitle>
      <RunLauncher knobs={knobs} />

      <SectionTitle note={runs.length + ' committed'}>Past runs</SectionTitle>
      <Card pad={0}>
        {runs.length === 0 ? (
          <Empty>
            No runs yet. Choose a dataset and mode above, then start a reconciliation.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Dataset</th>
                <th>Mode</th>
                <th style={{ textAlign: 'right' }}>Seed</th>
                <th style={{ textAlign: 'right' }}>Groups</th>
                <th style={{ textAlign: 'right' }}>Auto-cleared</th>
                <th style={{ textAlign: 'right' }}>False-match</th>
                <th style={{ textAlign: 'right' }}>Precision</th>
                <th style={{ textAlign: 'right' }}>Recall</th>
                <th style={{ textAlign: 'right' }}>Duration</th>
                <th>Output hash</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.run_id}>
                  <td>
                    <Link className="mono" href={'/runs/' + run.run_id}>
                      {run.run_id}
                    </Link>
                  </td>
                  <td>{run.dataset}</td>
                  <td>{run.mode.replace('_', ' ')}</td>
                  <td className="num">{run.seed}</td>
                  <td className="num">{run.match_groups}</td>
                  <td className="num">{(run.auto_clear_rate * 100).toFixed(1)}%</td>
                  <td className="num" style={{ color: run.false_match_rate > 0 ? 'var(--amber)' : 'var(--sage)' }}>
                    {(run.false_match_rate * 100).toFixed(2)}%
                  </td>
                  <td className="num">{run.precision.toFixed(3)}</td>
                  <td className="num">{run.recall.toFixed(3)}</td>
                  <td className="num">{run.wall_clock_ms} ms</td>
                  <td className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {shortHash(run.output_hash, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  );
}
