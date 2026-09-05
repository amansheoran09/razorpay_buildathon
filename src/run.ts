/**
 * One reconciliation run, end to end. Shared by the CLI and the API route.
 */

import { loadConfig, pricingFor } from './lib/config';
import { runId as makeRunId } from './lib/ids';
import { ingestDataset } from './ingest';
import { reconcile, type Adjudicator } from './engine';
import { scoreRun } from './eval/metrics';
import type {
  DatasetName,
  LlmInteraction,
  Run,
  RunArtifact,
  RunConfig,
  RunMetrics,
  RunMode,
} from './domain/types';

export interface RunOptions {
  dataset: DatasetName;
  mode: RunMode;
  seed?: number;
  runId?: string;
  root?: string;
  adjudicator?: Adjudicator;
  llmInteractions?: LlmInteraction[];
  onProgress?: (event: { stage: string; processed: number; total: number }) => void;
}

export async function executeRun(options: RunOptions): Promise<RunArtifact> {
  const cfg = loadConfig();
  const started = performance.now();
  const startedAt = new Date().toISOString();

  const config: RunConfig = {
    dataset: options.dataset,
    mode: options.mode,
    seed: options.seed ?? 42,
    auto_clear_threshold: cfg.autoClearThreshold,
    amount_tolerance_paise: cfg.amountTolerancePaise,
    date_window_days: cfg.dateWindowDays,
    max_candidates: cfg.maxCandidates,
    llm_model: cfg.llmModel,
  };

  const runId = options.runId ?? makeRunId(new Date(), 1);
  const ingested = ingestDataset(options.dataset, options.root);

  const engine = await reconcile({
    runId,
    config,
    ledger: ingested.ledger,
    gateway: ingested.gateway,
    bank: ingested.bank,
    now: startedAt,
    referenceLegibility: ingested.referenceLegibility,
    adjudicator: options.adjudicator,
    onProgress: options.onProgress,
  });

  // Duplicate rows detected at ingest are reported alongside parse warnings.
  // They were previously computed and discarded, which made the warning count
  // an undercount of what ingest actually saw.
  const duplicateWarnings = ingested.duplicates.map((group) => ({
    source: group.source as 'ledger' | 'gateway' | 'bank',
    row_number: 0,
    field: 'record_id',
    raw_value: group.record_ids.join(', '),
    reason: 'identical rows in the same source; flagged, not deduped',
  }));
  const allWarnings = [...ingested.warnings, ...duplicateWarnings];

  const score = scoreRun(engine.matches, ingested.groundTruth);
  const wallClock = performance.now() - started;
  const totalRecords = ingested.ledger.length + ingested.gateway.length + ingested.bank.length;

  const interactions = options.llmInteractions ?? [];
  const realCalls = interactions.filter((i) => !i.cached);
  const inputTokens = realCalls.reduce((a, i) => a + i.input_tokens, 0);
  const outputTokens = realCalls.reduce((a, i) => a + i.output_tokens, 0);
  const pricing = pricingFor(config.llm_model);
  const costUsd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  const costInr = costUsd * cfg.usdToInr;

  const metrics: RunMetrics = {
    total_records: totalRecords,
    ledger_records: ingested.ledger.length,
    gateway_records: ingested.gateway.length,
    bank_records: ingested.bank.length,
    match_groups: engine.matches.length,

    auto_cleared: score.auto_cleared,
    needs_review: score.needs_review,
    unmatched: score.unmatched,
    auto_clear_rate: score.auto_clear_rate,
    escalation_rate: score.escalation_rate,

    true_positives: score.true_positives,
    false_positives: score.false_positives,
    false_negatives: score.false_negatives,
    precision: score.precision,
    recall: score.recall,
    f1: score.f1,
    false_match_rate: score.false_match_rate,
    escalation_precision: score.escalation_precision,

    category_recall: score.category_recall,
    calibration_buckets: score.calibration_buckets,
    expected_calibration_error: score.expected_calibration_error,

    wall_clock_ms: Math.round(wallClock),
    records_per_second: Math.round((totalRecords / (wallClock / 1000)) * 100) / 100,
    llm_calls: realCalls.length,
    llm_calls_per_100_records: Math.round((realCalls.length / Math.max(totalRecords, 1)) * 100 * 100) / 100,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_inr: Math.round(costInr * 10_000) / 10_000,
    cost_per_record_inr: Math.round((costInr / Math.max(totalRecords, 1)) * 10_000) / 10_000,

    llm_schema_violations: interactions.filter((i) => !i.valid).length,
    llm_cache_hits: interactions.filter((i) => i.cached).length,
    output_hash: engine.outputHash,

    ingest_warnings: allWarnings.length,
    stage_coverage: engine.stageCoverage,
  };

  const run: Run = {
    run_id: runId,
    config,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: 'complete',
    metrics,
    error: null,
  };

  return {
    run,
    matches: engine.matches,
    records: { ledger: ingested.ledger, gateway: ingested.gateway, bank: ingested.bank },
    ingest_warnings: allWarnings,
    llm_interactions: interactions,
    failures: score.failures,
  };
}
