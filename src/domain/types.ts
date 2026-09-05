/**
 * The domain model (BUILD_SPEC section 6). Every other module imports from here.
 * All monetary fields are integer paise. No exceptions (P3).
 */

import type { ExceptionType } from './taxonomy';

export type SourceSystem = 'ledger' | 'gateway' | 'bank';
export type Currency = 'INR';

// ---------- Source records ----------

export interface LedgerRecord {
  record_id: string;
  source: 'ledger';
  invoice_no: string;
  customer_id: string;
  customer_name: string;
  issue_date: string;
  due_date: string;
  gross_amount_paise: number;
  tax_amount_paise: number;
  currency: Currency;
  status: 'open' | 'paid' | 'partially_paid' | 'written_off';
  expected_reference: string | null;
  raw_row: Record<string, string>;
}

export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet' | 'emi';

export interface GatewayRecord {
  record_id: string;
  source: 'gateway';
  payment_id: string;
  order_id: string | null;
  receipt: string | null;
  captured_at: string;
  amount_paise: number;
  fee_paise: number;
  tax_on_fee_paise: number;
  net_paise: number;
  method: PaymentMethod;
  status: 'captured' | 'refunded' | 'partially_refunded' | 'failed' | 'disputed';
  refund_paise: number;
  settlement_id: string | null;
  settled_at: string | null;
  raw_row: Record<string, string>;
}

export interface BankRecord {
  record_id: string;
  source: 'bank';
  value_date: string;
  posted_at: string;
  narration: string;
  reference_no: string | null;
  direction: 'credit' | 'debit';
  amount_paise: number;
  balance_paise: number;
  raw_row: Record<string, string>;
}

export type SourceRecord = LedgerRecord | GatewayRecord | BankRecord;

// ---------- Matching ----------

export type MatchTier =
  | 'exact'
  | 'tolerant'
  | 'combinatorial'
  | 'llm_adjudicated'
  | 'unmatched';

export type MatchStatus = 'auto_cleared' | 'needs_review' | 'rejected' | 'human_cleared';

export type DecidedBy = 'rules' | 'llm' | 'human';

export interface EvidenceItem {
  label: string;
  detail: string;
  weight: number;
  record_ids: string[];
}

export type StageName = 'ingest' | 'stage1' | 'stage2' | 'stage3' | 'stage4' | 'human';

export interface StageLogEntry {
  stage: StageName;
  outcome: 'matched' | 'no_candidate' | 'ambiguous' | 'rejected' | 'passed_through';
  note: string;
  candidates_considered: number;
  duration_ms: number;
  at: string;
}

export interface MatchGroup {
  match_id: string;
  run_id: string;
  tier: MatchTier;
  confidence: number;
  ledger_ids: string[];
  gateway_ids: string[];
  bank_ids: string[];
  reconciled_amount_paise: number;
  variance_paise: number;
  exception_type: ExceptionType | null;
  status: MatchStatus;
  rationale: string;
  evidence: EvidenceItem[];
  decided_by: DecidedBy;
  decided_at: string;
  stage_log: StageLogEntry[];
  llm_call_id: string | null;
  candidates?: CandidateGroup[];
}

// ---------- Candidates ----------

export interface CandidateScoreComponents {
  amount_proximity: number;
  date_proximity: number;
  reference_similarity: number;
  customer_match: number;
  method_plausibility: number;
}

export interface CandidateGroup {
  candidate_id: string;
  ledger_ids: string[];
  gateway_ids: string[];
  bank_ids: string[];
  reconciled_amount_paise: number;
  variance_paise: number;
  date_gap_days: number;
  score: number;
  score_components: CandidateScoreComponents;
  evidence: EvidenceItem[];
  rules_note: string;
  proposed_exception_type: ExceptionType | null;
}

// ---------- Runs ----------

export type RunMode = 'hybrid' | 'rules_only' | 'llm_only';
export type DatasetName = 'standard' | 'hard';

export interface RunConfig {
  dataset: DatasetName;
  mode: RunMode;
  seed: number;
  auto_clear_threshold: number;
  amount_tolerance_paise: number;
  date_window_days: number;
  max_candidates: number;
  llm_model: string;
}

export interface CalibrationBucket {
  lower: number;
  upper: number;
  count: number;
  stated_confidence_mean: number;
  actual_accuracy: number;
}

export interface RunMetrics {
  total_records: number;
  ledger_records: number;
  gateway_records: number;
  bank_records: number;
  match_groups: number;

  auto_cleared: number;
  needs_review: number;
  unmatched: number;
  auto_clear_rate: number;
  escalation_rate: number;

  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1: number;
  false_match_rate: number;
  escalation_precision: number;

  category_recall: Record<string, { total: number; caught: number; recall: number }>;

  calibration_buckets: CalibrationBucket[];
  expected_calibration_error: number;

  wall_clock_ms: number;
  records_per_second: number;
  llm_calls: number;
  llm_calls_per_100_records: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_inr: number;
  cost_per_record_inr: number;

  llm_schema_violations: number;
  llm_cache_hits: number;
  output_hash: string;

  ingest_warnings: number;
  stage_coverage: Record<string, number>;
}

export interface Run {
  run_id: string;
  config: RunConfig;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'complete' | 'failed';
  metrics: RunMetrics | null;
  error: string | null;
}

/** What is written to runs/RUNID.json and served read-only. */
export interface RunArtifact {
  run: Run;
  matches: MatchGroup[];
  records: {
    ledger: LedgerRecord[];
    gateway: GatewayRecord[];
    bank: BankRecord[];
  };
  ingest_warnings: IngestWarning[];
  llm_interactions: LlmInteraction[];
  failures: FailureReport;
}

export interface IngestWarning {
  source: SourceSystem;
  row_number: number;
  field: string;
  raw_value: string;
  reason: string;
}

export interface LlmInteraction {
  call_id: string;
  match_id: string;
  prompt_hash: string;
  system: string;
  user: string;
  raw_response: string;
  parsed: unknown;
  valid: boolean;
  violation_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  cached: boolean;
  duration_ms: number;
}

/** Material for the honesty report (BUILD_SPEC 15.5). */
export interface FailureReport {
  false_positives: FalsePositive[];
  false_negatives: FalseNegative[];
  correctly_declined: CorrectlyDeclined[];
}

export interface FalsePositive {
  match_id: string;
  proposed_ids: string[];
  true_ids: string[] | null;
  amount_at_risk_paise: number;
  confidence: number;
  tier: MatchTier;
  explanation: string;
}

export interface FalseNegative {
  truth_id: string;
  record_ids: string[];
  scenario: string;
  exception_type: ExceptionType | null;
  amount_paise: number;
  reason: string;
}

export interface CorrectlyDeclined {
  truth_id: string;
  record_ids: string[];
  scenario: string;
  note: string;
}

// ---------- Ground truth ----------

export interface GroundTruthEntry {
  truth_id: string;
  ledger_ids: string[];
  gateway_ids: string[];
  bank_ids: string[];
  exception_type: ExceptionType | null;
  scenario: string;
  is_resolvable: boolean;
  amount_paise: number;
}

export interface GroundTruth {
  dataset: DatasetName;
  seed: number;
  generated_at: string;
  entries: GroundTruthEntry[];
}

/** All record IDs in a group, canonically ordered. Used for set equality. */
export function groupKey(group: {
  ledger_ids: string[];
  gateway_ids: string[];
  bank_ids: string[];
}): string {
  return [...group.ledger_ids, ...group.gateway_ids, ...group.bank_ids].slice().sort().join('|');
}
