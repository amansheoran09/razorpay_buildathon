'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatPaise } from '@/lib/money';
import type { IngestWarning } from '@/domain/types';

export interface ExplorerRow {
  record_id: string;
  match_id: string | null;
  raw: Record<string, string>;
  normalized: Record<string, string | number>;
}

export interface ExplorerPayload {
  runId: string;
  warnings: IngestWarning[];
  ledger: ExplorerRow[];
  gateway: ExplorerRow[];
  bank: ExplorerRow[];
}

type Tab = 'ledger' | 'gateway' | 'bank';

const PAISE_FIELD = /_paise$/;

export function DataExplorer({ payload }: { payload: ExplorerPayload }) {
  const [tab, setTab] = useState<Tab>('bank');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(100);

  const rows = payload[tab];
  const columns = useMemo(() => Object.keys(rows[0]?.raw ?? {}), [rows]);
  const normalizedColumns = useMemo(() => Object.keys(rows[0]?.normalized ?? {}), [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => (r.record_id + ' ' + Object.values(r.raw).join(' ')).toLowerCase().includes(term));
  }, [rows, search]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        {(['ledger', 'gateway', 'bank'] as Tab[]).map((name) => (
          <button
            key={name}
            onClick={() => {
              setTab(name);
              setLimit(100);
            }}
            style={{
              padding: '5px 12px',
              border: '1px solid var(--rule)',
              borderRadius: 6,
              background: tab === name ? 'var(--slate-wash)' : 'transparent',
              color: tab === name ? 'var(--ink)' : 'var(--muted)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {name} <span className="mono">{payload[name].length}</span>
          </button>
        ))}
        <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 12 }}>
          {payload.warnings.length === 0
            ? 'No ingest warnings. Every row parsed.'
            : payload.warnings.length + ' rows failed to parse and were counted, not zeroed.'}
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search raw values"
          style={{
            marginLeft: 'auto',
            width: 260,
            padding: '5px 9px',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            background: 'var(--card)',
            color: 'var(--ink)',
            fontSize: 12,
          }}
        />
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--rule)', overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Record</th>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
              {normalizedColumns.map((c) => (
                <th key={'n-' + c} style={{ color: 'var(--slate)' }}>
                  {c}
                </th>
              ))}
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((row) => (
              <tr key={row.record_id}>
                <td className="mono" style={{ fontSize: 12 }}>{row.record_id}</td>
                {columns.map((c) => (
                  <td key={c} className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {row.raw[c]}
                  </td>
                ))}
                {normalizedColumns.map((c) => {
                  const value = row.normalized[c];
                  const display =
                    typeof value === 'number' && PAISE_FIELD.test(c) ? formatPaise(value) : String(value);
                  return (
                    <td key={'n-' + c} className="mono" style={{ fontSize: 12, color: 'var(--slate)', whiteSpace: 'nowrap' }}>
                      {display}
                    </td>
                  );
                })}
                <td>
                  {row.match_id ? (
                    <Link className="mono" href={'/runs/' + payload.runId + '/record/' + row.match_id} style={{ fontSize: 12 }}>
                      {row.match_id}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>unmatched</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > limit ? (
          <div style={{ padding: 14, textAlign: 'center' }}>
            <button
              onClick={() => setLimit((v) => v + 200)}
              style={{ padding: '6px 14px', border: '1px solid var(--rule)', borderRadius: 6, background: 'transparent', color: 'var(--slate)', cursor: 'pointer', fontSize: 12 }}
            >
              Show more ({filtered.length - limit} remaining)
            </button>
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
            Nothing matches that search. Clear it to see all {rows.length} rows.
          </div>
        ) : null}
      </div>
    </div>
  );
}
