'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatINR, formatVariance } from '@/lib/money';
import { ReconciliationStrip } from './ReconciliationStrip';
import type { QueueItem } from '@/eval/queue-model';

type Decision = 'approve' | 'reject' | 'reassign';

const FIELD_ROWS = ['Reference', 'Counterparty', 'Date', 'Amount', 'Status', 'Settlement', 'Fee'];

function severityColor(severity: string): string {
  if (severity === 'blocking') return 'var(--rust)';
  if (severity === 'review') return 'var(--amber)';
  return 'var(--muted)';
}

export function ExceptionQueue({ runId, items }: { runId: string; items: QueueItem[] }) {
  const [selected, setSelected] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [bandFilter, setBandFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'amount' | 'confidence' | 'age'>('amount');
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const key = item.exception_type ?? 'UNCLASSIFIED';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = items.filter((item) => {
      if (typeFilter && (item.exception_type ?? 'UNCLASSIFIED') !== typeFilter) return false;
      if (bandFilter === 'high' && item.confidence < 0.8) return false;
      if (bandFilter === 'mid' && (item.confidence < 0.5 || item.confidence >= 0.8)) return false;
      if (bandFilter === 'low' && item.confidence >= 0.5) return false;
      if (needle) {
        const hay = [item.match_id, item.rationale, item.exception_label, ...item.bank.map((b) => b.fields.map((f) => f.value).join(' '))]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return rows.sort((a, b) => {
      if (sortBy === 'confidence') return a.confidence - b.confidence;
      if (sortBy === 'age') return b.age_days - a.age_days;
      return b.amount_paise - a.amount_paise;
    });
  }, [items, typeFilter, bandFilter, search, sortBy]);

  const current = filtered[Math.min(selected, filtered.length - 1)];

  const decide = useCallback(
    async (action: Decision, candidateId?: string) => {
      if (!current) return;
      setDecisions((prev) => ({ ...prev, [current.match_id]: action }));
      setToast(action === 'approve' ? 'Match approved' : action === 'reject' ? 'Match rejected' : 'Match reassigned');
      setNote('');
      await fetch('/api/matches/' + current.match_id + '/decide?run=' + runId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reassigned_candidate_id: candidateId ?? null, note: note || null }),
      }).catch(() => undefined);
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    },
    [current, note, runId, filtered.length],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  // Decisions live in SQLite, not in this component. Reloading the page must
  // not lose an approval a reviewer already made.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/runs/' + runId + '/decisions')
      .then((r) => (r.ok ? r.json() : { decisions: [] }))
      .then((data: { decisions: { match_id: string; action: Decision }[] }) => {
        if (cancelled) return;
        const restored: Record<string, Decision> = {};
        for (const row of data.decisions) restored[row.match_id] = row.action;
        setDecisions(restored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (event.key === 'Escape') {
        (target as HTMLElement | null)?.blur();
        setShowHelp(false);
        return;
      }
      if (typing) return;

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (event.key === 'a') {
        event.preventDefault();
        void decide('approve');
      } else if (event.key === 'r') {
        event.preventDefault();
        void decide('reject');
      } else if (event.key === 'e') {
        event.preventDefault();
        noteRef.current?.focus();
      } else if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === '?') {
        event.preventDefault();
        setShowHelp((v) => !v);
      } else if (/^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const candidate = current?.candidates[index];
        if (candidate) {
          event.preventDefault();
          void decide('reassign', candidate.candidate_id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered.length, decide, current]);

  useEffect(() => {
    const row = listRef.current?.querySelector('[data-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const chip = (label: string, active: boolean, count: number, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: '3px 9px',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        background: active ? 'var(--slate-wash)' : 'var(--card)',
        color: active ? 'var(--ink)' : 'var(--muted)',
        cursor: 'pointer',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      {label} <span className="mono" style={{ color: 'var(--muted)' }}>{count}</span>
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        {chip('All', typeFilter === null, items.length, () => { setTypeFilter(null); setSelected(0); })}
        {Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) =>
            chip(type.toLowerCase().replace(/_/g, ' '), typeFilter === type, count, () => {
              setTypeFilter(typeFilter === type ? null : type);
              setSelected(0);
            }),
          )}
        <span style={{ width: 12 }} />
        {chip('conf < 0.50', bandFilter === 'low', items.filter((i) => i.confidence < 0.5).length, () => setBandFilter(bandFilter === 'low' ? null : 'low'))}
        {chip('0.50-0.80', bandFilter === 'mid', items.filter((i) => i.confidence >= 0.5 && i.confidence < 0.8).length, () => setBandFilter(bandFilter === 'mid' ? null : 'mid'))}
        {chip('0.80+', bandFilter === 'high', items.filter((i) => i.confidence >= 0.8).length, () => setBandFilter(bandFilter === 'high' ? null : 'high'))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelected(0); }}
            placeholder="Search narration, id, reason"
            style={{
              padding: '4px 8px', width: 220, border: '1px solid var(--rule)', borderRadius: 6,
              background: 'var(--card)', color: 'var(--ink)', fontSize: 12,
            }}
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'amount' | 'confidence' | 'age')}
            style={{
              padding: '4px 8px', border: '1px solid var(--rule)', borderRadius: 6,
              background: 'var(--card)', color: 'var(--ink)', fontSize: 12,
            }}
          >
            <option value="amount">Sort by amount at risk</option>
            <option value="confidence">Sort by lowest confidence</option>
            <option value="age">Sort by age</option>
          </select>
          <button
            onClick={() => setShowHelp((v) => !v)}
            style={{ padding: '4px 9px', border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--card)', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}
          >
            ? shortcuts
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '520px 1fr', gap: 0, border: '1px solid var(--rule)', background: 'var(--card)' }}>
        <div ref={listRef} style={{ borderRight: '1px solid var(--rule)', maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
              No exceptions in this filter. Clear the filters to see all {items.length}.
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === Math.min(selected, filtered.length - 1);
              const decided = decisions[item.match_id];
              return (
                <div
                  key={item.match_id}
                  data-selected={isSelected}
                  onClick={() => setSelected(index)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '52px 1fr 96px 78px 44px 34px',
                    alignItems: 'center',
                    gap: 8,
                    height: 40,
                    padding: '0 12px 0 10px',
                    borderBottom: '1px solid var(--rule)',
                    borderLeft: '2px solid ' + (isSelected ? 'var(--slate)' : severityColor(item.severity)),
                    background: isSelected ? 'var(--slate-wash)' : 'transparent',
                    cursor: 'pointer',
                    opacity: decided ? 0.55 : 1,
                  }}
                >
                  <ReconciliationStrip
                    ledger={item.has_ledger}
                    gateway={item.has_gateway}
                    bank={item.has_bank}
                    variancePaise={item.variance_paise}
                    amountPaise={item.amount_paise}
                  />
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.exception_label}
                    {decided ? <span style={{ color: 'var(--muted)' }}> &middot; {decided}</span> : null}
                  </div>
                  <div className="num">{formatINR(item.amount_paise)}</div>
                  <div className="num" style={{ color: item.variance_paise === 0 ? 'var(--muted)' : 'var(--amber)' }}>
                    {item.variance_paise === 0 ? '\u2014' : formatVariance(item.variance_paise)}
                  </div>
                  <div className="num" style={{ color: 'var(--muted)' }}>{item.confidence.toFixed(2)}</div>
                  <div className="num" style={{ color: 'var(--muted)' }}>{item.age_days}d</div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ padding: 20, boxShadow: '-1px 0 0 var(--rule)', maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
          {!current ? (
            <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>
              Nothing selected. Use j and k to move through the queue.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <ReconciliationStrip
                  ledger={current.has_ledger}
                  gateway={current.has_gateway}
                  bank={current.has_bank}
                  variancePaise={current.variance_paise}
                  amountPaise={current.amount_paise}
                  size="lg"
                />
                <div style={{ fontSize: 20, color: severityColor(current.severity) }}>{current.exception_label}</div>
                <Link className="mono" href={'/runs/' + runId + '/record/' + current.match_id} style={{ marginLeft: 'auto', fontSize: 12 }}>
                  {current.match_id} &rarr; audit trail
                </Link>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 16 }}>{current.suggested_action}</div>

              <ThreeColumns item={current} />

              <Panel title="Why the agent decided this">
                <blockquote style={{ borderLeft: '2px solid var(--rule)', paddingLeft: 12, margin: 0 }}>
                  {current.rationale}
                </blockquote>
                <div className="mono" style={{ color: 'var(--muted)', fontSize: 11, marginTop: 8 }}>
                  tier {current.tier} &middot; confidence {current.confidence.toFixed(2)} &middot;{' '}
                  {current.llm_call_id ?? 'decided by rules'}
                </div>
              </Panel>

              <Panel title={'Evidence (' + current.evidence.length + ')'}>
                {current.evidence.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 48px', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--rule)' }}>
                    <div style={{ color: 'var(--muted)' }}>{row.label}</div>
                    <div>{row.detail}</div>
                    <div className="num" style={{ color: 'var(--muted)' }}>{row.weight.toFixed(2)}</div>
                  </div>
                ))}
              </Panel>

              {current.candidates.length > 0 ? (
                <Panel title={'Candidates considered (' + current.candidates.length + ')'}>
                  {current.candidates.map((candidate, i) => (
                    <div key={candidate.candidate_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--rule)' }}>
                      <span className="mono" style={{ color: 'var(--muted)', width: 18 }}>{i + 1}</span>
                      <span className="mono" style={{ width: 108 }}>{candidate.candidate_id}</span>
                      <span style={{ flex: 1, color: 'var(--muted)', fontSize: 12 }}>{candidate.rules_note}</span>
                      <span className="num" style={{ width: 54 }}>{candidate.score.toFixed(3)}</span>
                      <button
                        onClick={() => void decide('reassign', candidate.candidate_id)}
                        style={{ padding: '3px 9px', border: '1px solid var(--rule)', borderRadius: 6, background: 'var(--card)', color: 'var(--slate)', cursor: 'pointer', fontSize: 12 }}
                      >
                        Use this instead
                      </button>
                    </div>
                  ))}
                </Panel>
              ) : null}

              <Panel title="Stage timeline">
                {current.stage_log.map((entry, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 110px 1fr 70px', gap: 10, padding: '4px 0', fontSize: 12 }}>
                    <span className="mono">{entry.stage}</span>
                    <span style={{ color: 'var(--muted)' }}>{entry.outcome.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--muted)' }}>{entry.note}</span>
                    <span className="num" style={{ color: 'var(--muted)' }}>{entry.duration_ms} ms</span>
                  </div>
                ))}
              </Panel>

              <div style={{ marginTop: 20, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
                <textarea
                  ref={noteRef}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note for the audit trail (press e to focus)"
                  rows={2}
                  style={{
                    width: '100%', padding: 8, border: '1px solid var(--rule)', borderRadius: 6,
                    background: 'var(--paper)', color: 'var(--ink)', fontSize: 13, marginBottom: 10, resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => void decide('approve')}
                    style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid var(--sage)', background: 'var(--sage)', color: 'var(--card)', cursor: 'pointer', fontSize: 13 }}
                  >
                    Approve match
                  </button>
                  <button
                    onClick={() => void decide('reject')}
                    style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid var(--rule)', background: 'var(--card)', color: 'var(--rust)', cursor: 'pointer', fontSize: 13 }}
                  >
                    Reject
                  </button>
                  <span style={{ marginLeft: 'auto', alignSelf: 'center', color: 'var(--muted)', fontSize: 12 }}>
                    {Math.min(selected + 1, filtered.length)} of {filtered.length}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {toast ? (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--ink)', color: 'var(--paper)', padding: '8px 18px', borderRadius: 6, fontSize: 13 }}>
          {toast}
        </div>
      ) : null}

      {showHelp ? <Shortcuts onClose={() => setShowHelp(false)} /> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * The three sources side by side, with matching fields aligned on the same
 * rows so the eye can compare straight down the columns. A missing record
 * gets an explicit empty state, never a blank column.
 */
function ThreeColumns({ item }: { item: QueueItem }) {
  const columns: [string, QueueItem['ledger']][] = [
    ['Ledger', item.ledger],
    ['Gateway', item.gateway],
    ['Bank', item.bank],
  ];

  const value = (col: QueueItem['ledger'], label: string): { text: string; mono: boolean } | null => {
    for (const record of col) {
      const field = record.fields.find((f) => f.label === label);
      if (field && field.value) {
        if (label === 'Amount') return { text: formatINR(Number(field.value)), mono: true };
        if (label === 'Fee') return { text: formatINR(Number(field.value)), mono: true };
        return { text: field.value, mono: field.mono };
      }
    }
    return null;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 1fr 1fr', border: '1px solid var(--rule)' }}>
      <div style={{ borderBottom: '1px solid var(--rule)' }} />
      {columns.map(([name, col]) => (
        <div key={name} style={{ padding: '7px 12px', borderLeft: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', fontSize: 12, color: 'var(--muted)' }}>
          {name}
          {col.length > 1 ? <span className="mono"> &times;{col.length}</span> : null}
        </div>
      ))}

      {FIELD_ROWS.map((label) => (
        <div key={label} style={{ display: 'contents' }}>
          <div style={{ padding: '6px 12px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--rule)' }}>{label}</div>
          {columns.map(([name, col]) => {
            const found = value(col, label);
            return (
              <div
                key={name + label}
                className={found?.mono ? 'mono' : ''}
                style={{
                  padding: '6px 12px', borderLeft: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
                  fontSize: 12, color: found ? 'var(--ink)' : 'var(--muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {found ? found.text : col.length === 0 ? 'no record' : '\u2014'}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['j / k', 'Next / previous exception'],
    ['a', 'Approve match'],
    ['r', 'Reject'],
    ['e', 'Focus the note field'],
    ['/', 'Focus search'],
    ['1-9', 'Reassign to candidate n'],
    ['?', 'Show or hide this overlay'],
    ['Esc', 'Leave a field'],
  ];
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(22,24,28,0.4)', display: 'grid', placeItems: 'center', zIndex: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--card)', border: '1px solid var(--rule)', padding: 24, minWidth: 340 }}
      >
        <h3 style={{ fontSize: 15, marginBottom: 14 }}>Keyboard shortcuts</h3>
        {rows.map(([key, description]) => (
          <div key={key} style={{ display: 'flex', gap: 16, padding: '4px 0' }}>
            <span className="mono" style={{ width: 60, color: 'var(--slate)' }}>{key}</span>
            <span>{description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
