import Link from 'next/link';
import { EXCEPTION_DEFINITIONS, type ExceptionType, type Severity } from '@/domain/taxonomy';

export function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 1440, margin: '0 auto', padding: '0 32px 64px' }}>{children}</div>;
}

export function Masthead({ runId, active }: { runId?: string; active?: string }) {
  const tabs = runId
    ? [
        ['Scorecard', `/runs/${runId}`],
        ['Exceptions', `/runs/${runId}/queue`],
        ['Source data', `/runs/${runId}/data`],
        ['Honesty report', `/runs/${runId}/honesty`],
      ]
    : [];

  return (
    <header style={{ borderBottom: '1px solid var(--rule)', marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, padding: '20px 0 14px' }}>
        <Link href="/" style={{ color: 'var(--ink)', fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em' }}>
          Settled
        </Link>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          Three-way reconciliation across ledger, gateway and bank
        </span>
        {runId ? (
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>
            {runId}
          </span>
        ) : null}
      </div>
      {tabs.length > 0 ? (
        <nav style={{ display: 'flex', gap: 24, paddingBottom: 0 }}>
          {tabs.map(([label, href]) => (
            <Link
              key={label}
              href={href as string}
              style={{
                color: active === label ? 'var(--ink)' : 'var(--muted)',
                paddingBottom: 10,
                borderBottom: active === label ? '1px solid var(--ink)' : '1px solid transparent',
                marginBottom: -1,
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '32px 0 12px' }}>
      <h2 style={{ fontSize: 15, fontWeight: 500 }}>{children}</h2>
      {note ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>{note}</span> : null}
    </div>
  );
}

export function Card({ children, pad = 20 }: { children: React.ReactNode; pad?: number }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--rule)', padding: pad }}>{children}</div>
  );
}

export function severityColor(severity: Severity): string {
  if (severity === 'blocking') return 'var(--rust)';
  if (severity === 'review') return 'var(--amber)';
  return 'var(--muted)';
}

export function ExceptionLabel({ type }: { type: ExceptionType | null }) {
  if (!type) {
    return <span style={{ color: 'var(--sage)' }}>Cleared</span>;
  }
  const def = EXCEPTION_DEFINITIONS[type];
  return <span style={{ color: severityColor(def.severity) }}>{def.label}</span>;
}

export function StatusLabel({ status }: { status: string }) {
  const map: Record<string, { text: string; color: string }> = {
    auto_cleared: { text: 'Auto-cleared', color: 'var(--sage)' },
    needs_review: { text: 'Needs review', color: 'var(--amber)' },
    human_cleared: { text: 'Approved', color: 'var(--sage)' },
    rejected: { text: 'Rejected', color: 'var(--rust)' },
  };
  const entry = map[status] ?? { text: status, color: 'var(--muted)' };
  return <span style={{ color: entry.color }}>{entry.text}</span>;
}

export function Figure({
  label,
  value,
  sub,
  dominant = false,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  dominant?: boolean;
  tone?: string;
}) {
  return (
    <div style={{ flex: 1, borderLeft: '1px solid var(--rule)', paddingLeft: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div
        className="mono"
        style={{ fontSize: dominant ? 32 : 20, color: tone ?? 'var(--ink)', lineHeight: 1.1, fontWeight: 500 }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>{children}</div>
  );
}
