/**
 * View model for the exception queue.
 *
 * The queue needs the three source records side by side with matching fields on
 * the same rows, so the eye can compare down the columns. That shape is built
 * here, on the server, rather than shipping the whole artifact to the browser.
 */

import { EXCEPTION_DEFINITIONS, type ExceptionType, type Severity } from '../domain/taxonomy';
import type { CandidateGroup, EvidenceItem, RunArtifact, StageLogEntry } from '../domain/types';

export interface RecordColumn {
  record_id: string;
  fields: { label: string; value: string; mono: boolean }[];
}

export interface QueueItem {
  match_id: string;
  tier: string;
  status: string;
  confidence: number;
  exception_type: ExceptionType | null;
  exception_label: string;
  severity: Severity;
  suggested_action: string;
  rationale: string;
  amount_paise: number;
  variance_paise: number;
  has_ledger: boolean;
  has_gateway: boolean;
  has_bank: boolean;
  value_date: string;
  age_days: number;
  evidence: EvidenceItem[];
  candidates: CandidateGroup[];
  stage_log: StageLogEntry[];
  ledger: RecordColumn[];
  gateway: RecordColumn[];
  bank: RecordColumn[];
  llm_call_id: string | null;
}

function daysSince(from: string, to: string): number {
  const a = Date.parse(from.slice(0, 10));
  const b = Date.parse(to.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

const PERIOD_END = '2026-03-31';

export function buildQueue(artifact: RunArtifact): QueueItem[] {
  const ledgerById = new Map(artifact.records.ledger.map((r) => [r.record_id, r]));
  const gatewayById = new Map(artifact.records.gateway.map((r) => [r.record_id, r]));
  const bankById = new Map(artifact.records.bank.map((r) => [r.record_id, r]));

  const items: QueueItem[] = [];

  for (const match of artifact.matches) {
    if (match.status === 'auto_cleared') continue;

    const def = match.exception_type ? EXCEPTION_DEFINITIONS[match.exception_type] : null;

    const ledger: RecordColumn[] = match.ledger_ids.flatMap((id) => {
      const r = ledgerById.get(id);
      if (!r) return [];
      return [
        {
          record_id: id,
          fields: [
            { label: 'Reference', value: r.invoice_no, mono: true },
            { label: 'Counterparty', value: r.customer_name, mono: false },
            { label: 'Date', value: r.issue_date, mono: true },
            { label: 'Amount', value: String(r.gross_amount_paise), mono: true },
            { label: 'Status', value: r.status, mono: false },
          ],
        },
      ];
    });

    const gateway: RecordColumn[] = match.gateway_ids.flatMap((id) => {
      const r = gatewayById.get(id);
      if (!r) return [];
      return [
        {
          record_id: id,
          fields: [
            { label: 'Reference', value: r.receipt ?? r.payment_id, mono: true },
            { label: 'Counterparty', value: r.method + ' payment', mono: false },
            { label: 'Date', value: r.captured_at.slice(0, 10), mono: true },
            { label: 'Amount', value: String(r.net_paise), mono: true },
            { label: 'Status', value: r.status, mono: false },
            { label: 'Settlement', value: r.settlement_id ?? '', mono: true },
            { label: 'Fee', value: String(r.fee_paise), mono: true },
          ],
        },
      ];
    });

    const bank: RecordColumn[] = match.bank_ids.flatMap((id) => {
      const r = bankById.get(id);
      if (!r) return [];
      return [
        {
          record_id: id,
          fields: [
            { label: 'Reference', value: r.reference_no ?? '', mono: true },
            { label: 'Counterparty', value: r.narration, mono: true },
            { label: 'Date', value: r.value_date, mono: true },
            { label: 'Amount', value: String(r.amount_paise), mono: true },
            { label: 'Status', value: r.direction, mono: false },
          ],
        },
      ];
    });

    const valueDate =
      bank[0]?.fields.find((f) => f.label === 'Date')?.value ??
      ledger[0]?.fields.find((f) => f.label === 'Date')?.value ??
      PERIOD_END;

    items.push({
      match_id: match.match_id,
      tier: match.tier,
      status: match.status,
      confidence: match.confidence,
      exception_type: match.exception_type,
      exception_label: def ? def.label : 'Unclassified',
      severity: def ? def.severity : 'review',
      suggested_action: def ? def.suggested_action : 'Review this record by hand.',
      rationale: match.rationale,
      amount_paise: match.reconciled_amount_paise,
      variance_paise: match.variance_paise,
      has_ledger: match.ledger_ids.length > 0,
      has_gateway: match.gateway_ids.length > 0,
      has_bank: match.bank_ids.length > 0,
      value_date: valueDate,
      age_days: daysSince(valueDate, PERIOD_END),
      evidence: match.evidence,
      candidates: match.candidates ?? [],
      stage_log: match.stage_log,
      ledger,
      gateway,
      bank,
      llm_call_id: match.llm_call_id,
    });
  }

  // A finance user works the biggest exposure first.
  return items.sort((a, b) => b.amount_paise - a.amount_paise);
}
