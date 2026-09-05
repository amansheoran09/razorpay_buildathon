/**
 * Engine state: the record pools, the indexes, and the match accumulator.
 *
 * Stages run in order over whatever the previous stage left unmatched. No
 * stage may mutate a match created by an earlier stage.
 */

import { formatId } from '../lib/ids';
import { normalizeRef } from '../ingest/normalize';
import type { NormalizedBank } from '../ingest';
import type {
  CandidateGroup,
  EvidenceItem,
  GatewayRecord,
  LedgerRecord,
  MatchGroup,
  MatchStatus,
  MatchTier,
  RunConfig,
  StageLogEntry,
  StageName,
} from '../domain/types';
import type { ExceptionType } from '../domain/taxonomy';
import { blocksAutoClear } from '../domain/taxonomy';

export interface EngineState {
  runId: string;
  config: RunConfig;
  ledger: LedgerRecord[];
  gateway: GatewayRecord[];
  bank: NormalizedBank[];
  ledgerById: Map<string, LedgerRecord>;
  gatewayById: Map<string, GatewayRecord>;
  bankById: Map<string, NormalizedBank>;
  gatewayByReceipt: Map<string, GatewayRecord[]>;
  gatewayBySettlement: Map<string, GatewayRecord[]>;
  /**
   * Bank credits indexed by exact paise amount.
   *
   * Stages 1 and 2 previously scanned the whole statement once per invoice,
   * which is O(invoices x bank lines) and turned a linear claim into quadratic
   * behaviour: ten times the records took roughly fifty times as long. Both
   * stages have an amount bound, so the scan becomes a handful of hash lookups.
   */
  bankCreditsByAmount: Map<number, NormalizedBank[]>;
  /** Debits by amount, so a reversal check is a lookup rather than a scan. */
  bankDebitsByAmount: Map<number, NormalizedBank[]>;
  /** Open gateway payments by settlement date, for the stage 3 window sweep. */
  gatewayBySettleDate: Map<string, GatewayRecord[]>;
  openLedger: Set<string>;
  openGateway: Set<string>;
  openBank: Set<string>;
  matches: MatchGroup[];
  nextMatchId: () => string;
  nextCandidateId: () => string;
  now: string;
  /** How legible this run's bank narrations were. Discounts negative conclusions. */
  referenceLegibility: number;
  /**
   * Called once per record a stage examines. The orchestrator turns this into
   * an SSE event every 25 records, so the progress readout reflects work done
   * rather than jumping once per stage.
   */
  tick: (stage: string) => void;
}

export function createEngineState(input: {
  runId: string;
  config: RunConfig;
  ledger: LedgerRecord[];
  gateway: GatewayRecord[];
  bank: NormalizedBank[];
  now: string;
  referenceLegibility?: number;
  tick?: (stage: string) => void;
}): EngineState {
  const gatewayByReceipt = new Map<string, GatewayRecord[]>();
  const gatewayBySettlement = new Map<string, GatewayRecord[]>();
  for (const g of input.gateway) {
    if (g.receipt) {
      const key = normalizeRef(g.receipt);
      const list = gatewayByReceipt.get(key);
      if (list) list.push(g);
      else gatewayByReceipt.set(key, [g]);
    }
    if (g.settlement_id) {
      const list = gatewayBySettlement.get(g.settlement_id);
      if (list) list.push(g);
      else gatewayBySettlement.set(g.settlement_id, [g]);
    }
  }

  const bankCreditsByAmount = new Map<number, NormalizedBank[]>();
  const bankDebitsByAmount = new Map<number, NormalizedBank[]>();
  for (const b of input.bank) {
    const index = b.direction === 'credit' ? bankCreditsByAmount : bankDebitsByAmount;
    const list = index.get(b.amount_paise);
    if (list) list.push(b);
    else index.set(b.amount_paise, [b]);
  }

  const gatewayBySettleDate = new Map<string, GatewayRecord[]>();
  for (const g of input.gateway) {
    const day = (g.settled_at ?? g.captured_at).slice(0, 10);
    const list = gatewayBySettleDate.get(day);
    if (list) list.push(g);
    else gatewayBySettleDate.set(day, [g]);
  }

  let matchSeq = 0;
  let candidateSeq = 0;

  return {
    runId: input.runId,
    config: input.config,
    ledger: input.ledger,
    gateway: input.gateway,
    bank: input.bank,
    ledgerById: new Map(input.ledger.map((r) => [r.record_id, r])),
    gatewayById: new Map(input.gateway.map((r) => [r.record_id, r])),
    bankById: new Map(input.bank.map((r) => [r.record_id, r])),
    gatewayByReceipt,
    gatewayBySettlement,
    bankCreditsByAmount,
    bankDebitsByAmount,
    gatewayBySettleDate,
    openLedger: new Set(input.ledger.map((r) => r.record_id)),
    openGateway: new Set(input.gateway.map((r) => r.record_id)),
    openBank: new Set(input.bank.map((r) => r.record_id)),
    matches: [],
    nextMatchId: () => formatId('MCH', ++matchSeq),
    nextCandidateId: () => formatId('CND', ++candidateSeq),
    now: input.now,
    referenceLegibility: input.referenceLegibility ?? 1,
    tick: input.tick ?? (() => undefined),
  };
}

export interface CommitInput {
  tier: MatchTier;
  confidence: number;
  ledger_ids: string[];
  gateway_ids: string[];
  bank_ids: string[];
  reconciled_amount_paise: number;
  variance_paise: number;
  exception_type: ExceptionType | null;
  rationale: string;
  evidence: EvidenceItem[];
  stage_log: StageLogEntry[];
  decided_by?: MatchGroup['decided_by'];
  candidates?: CandidateGroup[];
  llm_call_id?: string | null;
  forceStatus?: MatchStatus;
}

/**
 * Auto-clearing is conservative (P4): confidence at or above threshold AND
 * variance inside tolerance AND no blocking exception. When in doubt, escalate.
 */
export function decideStatus(state: EngineState, input: CommitInput): MatchStatus {
  if (input.forceStatus) return input.forceStatus;
  const meetsConfidence = input.confidence >= state.config.auto_clear_threshold;
  const withinTolerance = Math.abs(input.variance_paise) <= state.config.amount_tolerance_paise;
  const blocked = blocksAutoClear(input.exception_type);
  return meetsConfidence && withinTolerance && !blocked ? 'auto_cleared' : 'needs_review';
}

export function commitMatch(state: EngineState, input: CommitInput): MatchGroup {
  const match: MatchGroup = {
    match_id: state.nextMatchId(),
    run_id: state.runId,
    tier: input.tier,
    confidence: input.confidence,
    ledger_ids: input.ledger_ids,
    gateway_ids: input.gateway_ids,
    bank_ids: input.bank_ids,
    reconciled_amount_paise: input.reconciled_amount_paise,
    variance_paise: input.variance_paise,
    exception_type: input.exception_type,
    status: decideStatus(state, input),
    rationale: input.rationale.slice(0, 240),
    evidence: input.evidence,
    decided_by: input.decided_by ?? 'rules',
    decided_at: state.now,
    stage_log: input.stage_log,
    llm_call_id: input.llm_call_id ?? null,
    ...(input.candidates ? { candidates: input.candidates } : {}),
  };

  for (const id of input.ledger_ids) state.openLedger.delete(id);
  for (const id of input.gateway_ids) state.openGateway.delete(id);
  for (const id of input.bank_ids) state.openBank.delete(id);

  state.matches.push(match);
  return match;
}

export function stageEntry(
  stage: StageName,
  outcome: StageLogEntry['outcome'],
  note: string,
  candidatesConsidered: number,
  durationMs: number,
  at: string,
): StageLogEntry {
  return {
    stage,
    outcome,
    note,
    candidates_considered: candidatesConsidered,
    duration_ms: Math.round(durationMs),
    at,
  };
}

export function openLedgerRecords(state: EngineState): LedgerRecord[] {
  return state.ledger.filter((r) => state.openLedger.has(r.record_id));
}
export function openGatewayRecords(state: EngineState): GatewayRecord[] {
  return state.gateway.filter((r) => state.openGateway.has(r.record_id));
}
export function openBankRecords(state: EngineState): NormalizedBank[] {
  return state.bank.filter((r) => state.openBank.has(r.record_id));
}

/** Open gateway payments settling within `days` of `isoDate`, by lookup. */
export function gatewaysNearDate(state: EngineState, isoDate: string, days: number): GatewayRecord[] {
  const out: GatewayRecord[] = [];
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number) as [number, number, number];
  const base = Date.UTC(y, m - 1, d);
  for (let offset = -days; offset <= days; offset++) {
    const at = new Date(base + offset * 86_400_000);
    const key =
      at.getUTCFullYear() +
      '-' +
      String(at.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(at.getUTCDate()).padStart(2, '0');
    const bucket = state.gatewayBySettleDate.get(key);
    if (!bucket) continue;
    for (const g of bucket) if (state.openGateway.has(g.record_id)) out.push(g);
  }
  return out;
}

/**
 * Open bank credits whose amount is within `tolerance` paise of `target`.
 * Exactly the set the old full scan would have kept, reached by lookup.
 */
export function creditsNearAmount(state: EngineState, target: number, tolerance: number): NormalizedBank[] {
  const out: NormalizedBank[] = [];
  for (let delta = -tolerance; delta <= tolerance; delta++) {
    const bucket = state.bankCreditsByAmount.get(target + delta);
    if (!bucket) continue;
    for (const b of bucket) if (state.openBank.has(b.record_id)) out.push(b);
  }
  return out;
}
