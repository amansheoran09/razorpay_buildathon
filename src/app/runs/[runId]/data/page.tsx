import { notFound } from 'next/navigation';
import { readArtifact } from '@/eval/artifacts';
import { Masthead, Shell } from '@/app/components/Chrome';
import { DataExplorer } from '@/app/components/DataExplorer';
import type { ExplorerPayload } from '@/app/components/DataExplorer';

export const dynamic = 'force-dynamic';

/**
 * This screen exists so a judge can verify the messy data was not hidden. Raw
 * CSV values sit next to the normalised ones the engine actually used.
 */
export default async function DataPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const artifact = readArtifact(runId);
  if (!artifact) notFound();

  const owner = new Map<string, string>();
  for (const m of artifact.matches) {
    for (const id of [...m.ledger_ids, ...m.gateway_ids, ...m.bank_ids]) owner.set(id, m.match_id);
  }

  const payload: ExplorerPayload = {
    runId,
    warnings: artifact.ingest_warnings,
    ledger: artifact.records.ledger.map((r) => ({
      record_id: r.record_id,
      match_id: owner.get(r.record_id) ?? null,
      raw: r.raw_row,
      normalized: {
        gross_amount_paise: r.gross_amount_paise,
        tax_amount_paise: r.tax_amount_paise,
        expected_reference: r.expected_reference ?? '',
      },
    })),
    gateway: artifact.records.gateway.map((r) => ({
      record_id: r.record_id,
      match_id: owner.get(r.record_id) ?? null,
      raw: r.raw_row,
      normalized: {
        amount_paise: r.amount_paise,
        fee_paise: r.fee_paise,
        net_paise: r.net_paise,
        settlement_id: r.settlement_id ?? '',
      },
    })),
    bank: artifact.records.bank.map((r) => ({
      record_id: r.record_id,
      match_id: owner.get(r.record_id) ?? null,
      raw: r.raw_row,
      normalized: {
        amount_paise: r.amount_paise,
        balance_paise: r.balance_paise,
        direction: r.direction,
        reference_no: r.reference_no ?? '',
      },
    })),
  };

  return (
    <Shell>
      <Masthead runId={runId} active="Source data" />
      <DataExplorer payload={payload} />
    </Shell>
  );
}
