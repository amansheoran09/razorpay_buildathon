/**
 * Engine orchestrator: runs the stages in order.
 *
 * Stage 4 is injected rather than imported so the deterministic engine has no
 * dependency on the LLM layer at all (P1). rules_only simply passes no
 * adjudicator; llm_only skips stages 1-3.
 */

import { hashObject } from '../lib/hash';
import type { CandidateGroup, MatchGroup, RunConfig } from '../domain/types';
import type { NormalizedBank } from '../ingest';
import type { GatewayRecord, LedgerRecord } from '../domain/types';
import { createEngineState, type EngineState } from './state';
import { runStage1 } from './stage1-exact';
import { runStage2 } from './stage2-tolerant';
import { runStage3 } from './stage3-combinatorial';
import { runResidual } from './residual';
import { runAttach } from './attach';
import { findShadows, holdShadows, restoreShadows } from './dedupe';
import { buildCandidates } from './candidates';

export interface StageTiming {
  stage: string;
  matched: number;
  duration_ms: number;
}

export interface AdjudicationRequest {
  match: MatchGroup;
  candidates: CandidateGroup[];
}

export type Adjudicator = (requests: AdjudicationRequest[], state: EngineState) => Promise<void>;

export interface EngineInput {
  runId: string;
  config: RunConfig;
  ledger: LedgerRecord[];
  gateway: GatewayRecord[];
  bank: NormalizedBank[];
  now: string;
  referenceLegibility?: number;
  adjudicator?: Adjudicator;
  onProgress?: (event: { stage: string; processed: number; total: number }) => void;
}

export interface EngineResult {
  matches: MatchGroup[];
  timings: StageTiming[];
  outputHash: string;
  stageCoverage: Record<string, number>;
}

export async function reconcile(input: EngineInput): Promise<EngineResult> {
  const total = input.ledger.length + input.gateway.length + input.bank.length;

  // BUILD_SPEC section 14: emit an event every 25 records so the progress
  // readout reflects work actually done, not one jump per stage.
  let examined = 0;
  const state = createEngineState({
    ...input,
    tick: (stage) => {
      examined += 1;
      if (examined % 25 === 0) {
        input.onProgress?.({ stage, processed: Math.min(examined, total), total });
      }
    },
  });
  const timings: StageTiming[] = [];
  const report = (stage: string): void => {
    const processed = total - (state.openLedger.size + state.openGateway.size + state.openBank.size);
    input.onProgress?.({ stage, processed, total });
  };

  // Duplicated rows make the stage 1 and 2 lookups ambiguous, so the later
  // copies are held aside and restored to their group afterwards.
  const shadows = input.config.mode === 'llm_only' ? [] : findShadows(state);
  holdShadows(state, shadows);

  if (input.config.mode !== 'llm_only') {
    const s1 = runStage1(state);
    timings.push({ stage: 'stage1', matched: s1.matched, duration_ms: s1.durationMs });
    report('stage1');

    const s2 = runStage2(state);
    timings.push({ stage: 'stage2', matched: s2.matched, duration_ms: s2.durationMs });
    report('stage2');

    const s3 = runStage3(state);
    timings.push({ stage: 'stage3', matched: s3.matched + s3.ambiguous, duration_ms: s3.durationMs });
    report('stage3');

    const attachStarted = performance.now();
    const attach = runAttach(state);
    const restored = restoreShadows(state, shadows, attachStarted);
    timings.push({ stage: 'attach', matched: attach.attached + restored, duration_ms: performance.now() - attachStarted });
    report('attach');
  }

  if (input.adjudicator && input.config.mode !== 'rules_only') {
    const startedS4 = performance.now();
    const requests = buildCandidates(state);
    await input.adjudicator(requests, state);
    timings.push({ stage: 'stage4', matched: requests.length, duration_ms: performance.now() - startedS4 });
    report('stage4');
  }

  const residual = runResidual(state);
  timings.push({ stage: 'residual', matched: residual.classified, duration_ms: residual.durationMs });
  report('residual');

  const matches = state.matches.slice().sort((a, b) => (a.match_id < b.match_id ? -1 : 1));

  const stageCoverage: Record<string, number> = {};
  for (const t of timings) stageCoverage[t.stage] = t.matched;

  return {
    matches,
    timings,
    stageCoverage,
    // Hash the decision content only - ids and timings would make it unstable.
    outputHash: hashObject(
      matches.map((m) => ({
        ledger_ids: m.ledger_ids.slice().sort(),
        gateway_ids: m.gateway_ids.slice().sort(),
        bank_ids: m.bank_ids.slice().sort(),
        tier: m.tier,
        status: m.status,
        confidence: m.confidence,
        exception_type: m.exception_type,
        variance_paise: m.variance_paise,
      })),
    ),
  };
}

export type { EngineState };
