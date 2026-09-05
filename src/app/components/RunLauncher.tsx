'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

interface Knob {
  label: string;
  value: string;
  note: string;
}

export function RunLauncher({ knobs }: { knobs: Knob[] }) {
  const router = useRouter();
  const [dataset, setDataset] = useState<'standard' | 'hard'>('standard');
  const [mode, setMode] = useState<'hybrid' | 'rules_only' | 'llm_only'>('rules_only');
  const [seed, setSeed] = useState(42);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; processed: number; total: number; rps: number } | null>(null);
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setStatus('Starting');
    setProgress(null);

    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset, mode, seed }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setStatus(body?.error ?? 'Could not start the run. Check the server log and try again.');
      running.current = false;
      return;
    }
    const { run_id: runId } = (await response.json()) as { run_id: string };
    setStatus('Running');

    const source = new EventSource('/api/runs/' + runId + '/stream');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as Record<string, unknown>;
      if (data.type === 'progress') {
        setProgress({
          stage: String(data.stage),
          processed: Number(data.processed),
          total: Number(data.total),
          rps: Number(data.records_per_second),
        });
      }
      if (data.type === 'done') {
        source.close();
        running.current = false;
        if (data.error) {
          setStatus('Run failed: ' + String(data.error));
          return;
        }
        setStatus('Complete');
        router.push('/runs/' + runId);
        router.refresh();
      }
    };
    source.onerror = () => {
      source.close();
      running.current = false;
      setStatus('Lost the progress stream. The run may still have finished.');
    };
  }, [dataset, mode, seed, router]);

  const stages = ['ingest', 'stage1', 'stage2', 'stage3', 'attach', 'stage4', 'residual'];
  const currentIndex = progress ? stages.indexOf(progress.stage) : -1;

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', gap: 32, padding: 20, borderBottom: '1px solid var(--rule)' }}>
        <Field label="Dataset">
          <Choice options={[['standard', 'Standard'], ['hard', 'Hard']]} value={dataset} onChange={(v) => setDataset(v as 'standard' | 'hard')} />
        </Field>
        <Field label="Mode">
          <Choice
            options={[['rules_only', 'Rules only'], ['hybrid', 'Hybrid'], ['llm_only', 'Model only']]}
            value={mode}
            onChange={(v) => setMode(v as 'hybrid' | 'rules_only' | 'llm_only')}
          />
        </Field>
        <Field label="Seed">
          <input
            className="mono"
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
            style={{
              width: 80,
              padding: '5px 8px',
              border: '1px solid var(--rule)',
              borderRadius: 6,
              background: 'var(--paper)',
              color: 'var(--ink)',
            }}
          />
        </Field>
        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
          <button
            onClick={start}
            style={{
              padding: '8px 18px',
              borderRadius: 6,
              border: '1px solid var(--slate)',
              background: 'var(--slate)',
              color: 'var(--card)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Start reconciliation
          </button>
        </div>
      </div>

      {status ? (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 10 }}>
            {stages.map((stage, i) => (
              <span
                key={stage}
                className="mono"
                style={{
                  fontSize: 12,
                  color: i <= currentIndex ? 'var(--ink)' : 'var(--muted)',
                  borderBottom: i === currentIndex ? '1px solid var(--slate)' : '1px solid transparent',
                  paddingBottom: 2,
                }}
              >
                {stage}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>{status}</span>
          </div>
          {progress ? (
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
              {progress.processed} / {progress.total} records &middot; {progress.rps.toFixed(1)} rec/s
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, padding: '4px 0' }}>
        {knobs.map((knob) => (
          <div key={knob.label} style={{ padding: '10px 20px', minWidth: 190 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{knob.label}</div>
            <div className="mono" style={{ fontSize: 13 }}>{knob.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{knob.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Choice({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex' }}>
      {options.map(([key, label], i) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '5px 12px',
            border: '1px solid var(--rule)',
            marginLeft: i === 0 ? 0 : -1,
            background: value === key ? 'var(--slate-wash)' : 'var(--paper)',
            color: value === key ? 'var(--ink)' : 'var(--muted)',
            cursor: 'pointer',
            fontSize: 13,
            borderRadius: i === 0 ? '6px 0 0 6px' : i === options.length - 1 ? '0 6px 6px 0' : 0,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
