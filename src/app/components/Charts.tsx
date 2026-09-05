'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CalibrationBucket } from '@/domain/types';

/**
 * Stated confidence against observed accuracy, with the y=x diagonal drawn as
 * a reference. A well-calibrated system hugs the diagonal.
 */
export function CalibrationChart({ buckets, ece }: { buckets: CalibrationBucket[]; ece: number }) {
  const data = buckets.map((b) => ({
    stated: b.stated_confidence_mean,
    actual: b.actual_accuracy,
    count: b.count,
    band: b.lower.toFixed(1) + '-' + b.upper.toFixed(1),
  }));

  return (
    <div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
            <CartesianGrid stroke="var(--rule)" strokeDasharray="2 3" />
            <XAxis
              type="number"
              dataKey="stated"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              stroke="var(--rule)"
              label={{ value: 'stated confidence', position: 'insideBottom', offset: -14, fill: 'var(--muted)', fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="actual"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              stroke="var(--rule)"
            />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--muted)" strokeDasharray="4 4" />
            <Tooltip
              contentStyle={{
                background: 'var(--card)',
                border: '1px solid var(--rule)',
                borderRadius: 0,
                fontSize: 12,
                color: 'var(--ink)',
              }}
              formatter={(value) => [Number(value).toFixed(3), '']}
            />
            <Scatter data={data} fill="var(--slate)" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
        expected calibration error {ece.toFixed(4)}
      </div>
    </div>
  );
}

/** Horizontal bars, total generated versus caught, sorted by volume. */
export function CategoryBreakdown({
  rows,
}: {
  rows: { name: string; total: number; caught: number; recall: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div>
      {rows.map((row) => (
        <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 26 }}>
          <div className="mono" style={{ width: 190, fontSize: 11, color: 'var(--muted)' }}>
            {row.name}
          </div>
          <div style={{ flex: 1, position: 'relative', height: 10, background: 'var(--paper)' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: (row.total / max) * 100 + '%',
                background: 'var(--rule)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: (row.caught / max) * 100 + '%',
                background: row.recall >= 0.9 ? 'var(--sage)' : row.recall >= 0.5 ? 'var(--amber)' : 'var(--rust)',
              }}
            />
          </div>
          <div className="num" style={{ width: 74, fontSize: 12 }}>
            {row.caught}/{row.total}
          </div>
          <div className="num" style={{ width: 54, fontSize: 12, color: 'var(--muted)' }}>
            {(row.recall * 100).toFixed(0)}%
          </div>
        </div>
      ))}
    </div>
  );
}

/** Throughput over the life of the run, for the scorecard footer. */
export function StageTiming({ rows }: { rows: { stage: string; matched: number }[] }) {
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--rule)" strokeDasharray="2 3" />
          <XAxis dataKey="stage" tick={{ fill: 'var(--muted)', fontSize: 11 }} stroke="var(--rule)" />
          <YAxis tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }} stroke="var(--rule)" />
          <Tooltip
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 0, fontSize: 12 }}
          />
          <Line type="monotone" dataKey="matched" stroke="var(--slate)" strokeWidth={1.5} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
