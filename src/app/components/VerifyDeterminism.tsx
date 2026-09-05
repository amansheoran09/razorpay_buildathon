'use client';

import { useState } from 'react';

interface Result {
  identical: boolean;
  expected_hash: string;
  actual_hash: string;
  elapsed_ms: number;
  matches_compared: number;
}

/**
 * Re-runs this configuration and compares output hashes in front of the user.
 * The claim "same seed, same output" is worth more when a judge can press it.
 */
export function VerifyDeterminism({ runId }: { runId: string }) {
  const [state, setState] = useState<'idle' | 'running'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = async (): Promise<void> => {
    setState('running');
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/runs/' + runId + '/verify', { method: 'POST' });
      if (!response.ok) throw new Error('verify failed');
      setResult((await response.json()) as Result);
    } catch {
      setError('The replay did not complete. Run it from the terminal to see why.');
    } finally {
      setState('idle');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
      <button
        onClick={() => void verify()}
        disabled={state === 'running'}
        style={{
          padding: '7px 16px',
          borderRadius: 6,
          border: '1px solid var(--slate)',
          background: state === 'running' ? 'var(--slate-wash)' : 'var(--card)',
          color: 'var(--slate)',
          cursor: state === 'running' ? 'default' : 'pointer',
          fontSize: 13,
        }}
      >
        {state === 'running' ? 'Re-running\u2026' : 'Verify determinism'}
      </button>

      {result ? (
        <span style={{ color: result.identical ? 'var(--sage)' : 'var(--rust)', fontSize: 13 }}>
          {result.identical ? 'Identical.' : 'Hashes differ.'}{' '}
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
            {result.matches_compared} matches replayed in {result.elapsed_ms} ms &middot; {result.actual_hash.slice(0, 16)}
          </span>
        </span>
      ) : null}

      {error ? <span style={{ color: 'var(--rust)', fontSize: 13 }}>{error}</span> : null}
    </div>
  );
}
