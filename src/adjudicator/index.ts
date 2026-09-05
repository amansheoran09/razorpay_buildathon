/**
 * Stage 4 - LLM adjudication (BUILD_SPEC section 11).
 *
 * The model receives candidate groups produced by deterministic code and
 * returns only a choice. It cannot emit an amount, an account or a new record.
 * Every response passes the four-check gate; failures are counted, logged and
 * escalated, never retried into submission.
 */

import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, supportsTemperature } from '../lib/config';
import { EXCEPTION_DEFINITIONS } from '../domain/taxonomy';
import type { LlmInteraction, MatchGroup, RunMode } from '../domain/types';
import type { AdjudicationRequest, Adjudicator } from '../engine';
import type { EngineState } from '../engine/state';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';
import { keyFor, readCache, writeCache } from './cache';
import { validateAdjudication, VIOLATION_RATIONALE } from './validate';

export interface AdjudicatorHandle {
  adjudicator: Adjudicator | undefined;
  interactions: LlmInteraction[];
  /** False when this mode needs stage 4 and stage 4 cannot run. */
  available: boolean;
  unavailableReason: string | null;
}

/**
 * The wire call, isolated behind an interface.
 *
 * Everything else in stage 4 - prompt construction, the four-check gate, the
 * cache, and how an accepted decision is applied to a match - is transport
 * independent, so it can be driven end to end in tests without a network or an
 * API key. Production passes the real Anthropic client.
 */
export interface LlmTransport {
  (system: string, user: string, temperature: number | null): Promise<{
    raw: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

/** Run `limit` promises at a time, preserving input order in the results. */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
}

export function createAdjudicator(mode: RunMode, transport?: LlmTransport): AdjudicatorHandle {
  const interactions: LlmInteraction[] = [];
  const cfg = loadConfig();

  if (mode === 'rules_only') {
    return { adjudicator: undefined, interactions, available: true, unavailableReason: null };
  }

  if (!cfg.llmEnabled) {
    return {
      adjudicator: undefined,
      interactions,
      available: false,
      unavailableReason: 'SETTLED_LLM_ENABLED is false, so stage 4 is switched off.',
    };
  }

  if (transport) {
    const adjudicator: Adjudicator = async (requests, state) => {
      await mapWithConcurrency(requests, cfg.llmConcurrency, async (request) => {
        await adjudicateOne(transport, state, request, interactions, supportsTemperature(cfg.llmModel) ? 0 : null);
      });
    };
    return { adjudicator, interactions, available: true, unavailableReason: null };
  }

  if (!cfg.apiKeyPresent) {
    return {
      adjudicator: undefined,
      interactions,
      available: false,
      unavailableReason:
        'ANTHROPIC_API_KEY is not set. A ' + mode + ' run without stage 4 is not a ' + mode + ' run, so it is refused rather than reported as one.',
    };
  }

  const client = new Anthropic();
  const temperature = supportsTemperature(cfg.llmModel) ? 0 : null;
  const live: LlmTransport = (system, user, temp) => callModel(client, system, user, temp);

  const adjudicator: Adjudicator = async (requests, state) => {
    await mapWithConcurrency(requests, cfg.llmConcurrency, async (request) => {
      await adjudicateOne(live, state, request, interactions, temperature);
    });
  };

  return { adjudicator, interactions, available: true, unavailableReason: null };
}

async function callModel(
  client: Anthropic,
  system: string,
  user: string,
  temperature: number | null,
): Promise<{ raw: string; inputTokens: number; outputTokens: number }> {
  const cfg = loadConfig();
  const params: Record<string, unknown> = {
    model: cfg.llmModel,
    max_tokens: cfg.llmMaxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (temperature !== null) params.temperature = temperature;

  const response = await client.messages.create(params as never);
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
  return {
    raw: text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function adjudicateOne(
  transport: LlmTransport,
  state: EngineState,
  request: AdjudicationRequest,
  interactions: LlmInteraction[],
  temperature: number | null,
): Promise<void> {
  const cfg = loadConfig();
  const { match, candidates } = request;
  if (candidates.length === 0) return;

  const prompt = buildUserPrompt(state, match, candidates);
  const hash = keyFor({ system: SYSTEM_PROMPT, user: prompt.user, model: cfg.llmModel, temperature });
  const started = performance.now();

  let cached = cfg.llmCache ? readCache(hash) : null;
  let fromCache = cached !== null;

  if (!cached) {
    try {
      cached = await transport(SYSTEM_PROMPT, prompt.user, temperature);
    } catch {
      // One retry on transport failure only. Never retry a validation failure.
      try {
        await new Promise((r) => setTimeout(r, 750));
        cached = await transport(SYSTEM_PROMPT, prompt.user, temperature);
      } catch (err) {
        recordInteraction(interactions, match, hash, prompt, '', false, 'Transport failure: ' + String(err), 0, 0, false, performance.now() - started);
        applyEscalation(match, 'Model call failed; escalated for review.');
        return;
      }
    }
    if (cfg.llmCache) writeCache(hash, cfg.llmModel, cached);
    fromCache = false;
  }

  const result = validateAdjudication(cached.raw, {
    candidateIds: prompt.candidateIds,
    recordIds: prompt.recordIds,
  });

  recordInteraction(
    interactions,
    match,
    hash,
    prompt,
    cached.raw,
    result.ok,
    result.ok ? null : result.reason,
    cached.inputTokens,
    cached.outputTokens,
    fromCache,
    performance.now() - started,
  );

  if (!result.ok) {
    applyEscalation(match, VIOLATION_RATIONALE);
    return;
  }

  applyAdjudication(state, match, request, result.value, hash);
}

function recordInteraction(
  interactions: LlmInteraction[],
  match: MatchGroup,
  hash: string,
  prompt: { user: string },
  raw: string,
  valid: boolean,
  violation: string | null,
  inputTokens: number,
  outputTokens: number,
  cached: boolean,
  durationMs: number,
): void {
  interactions.push({
    call_id: 'LLM-' + hash.slice(0, 10),
    match_id: match.match_id,
    prompt_hash: hash,
    system: SYSTEM_PROMPT,
    user: prompt.user,
    raw_response: raw,
    parsed: null,
    valid,
    violation_reason: violation,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached,
    duration_ms: Math.round(durationMs),
  });
}

function applyEscalation(match: MatchGroup, rationale: string): void {
  match.status = 'needs_review';
  match.exception_type = 'UNMATCHED_RESIDUAL';
  match.rationale = rationale;
  match.decided_by = 'llm';
  match.stage_log.push({
    stage: 'stage4',
    outcome: 'rejected',
    note: rationale,
    candidates_considered: match.candidates?.length ?? 0,
    duration_ms: 0,
    at: match.decided_at,
  });
}

/**
 * Apply an accepted adjudication. Note what is NOT read from the model here:
 * no amount, no date, no record id. Every value written to the match comes
 * from the candidate that deterministic code built.
 */
function applyAdjudication(
  state: EngineState,
  match: MatchGroup,
  request: AdjudicationRequest,
  decision: { decision: string; candidate_id: string | null; exception_type: MatchGroup['exception_type']; confidence: number; rationale: string; evidence_ids: string[] },
  hash: string,
): void {
  match.decided_by = 'llm';
  match.llm_call_id = 'LLM-' + hash.slice(0, 10);
  match.confidence = decision.confidence;
  match.rationale = decision.rationale;
  match.exception_type = decision.exception_type;

  if (decision.decision !== 'accept_candidate' || decision.candidate_id === null) {
    match.status = 'needs_review';
    match.stage_log.push({
      stage: 'stage4',
      outcome: decision.decision === 'no_match' ? 'no_candidate' : 'ambiguous',
      note: decision.rationale,
      candidates_considered: request.candidates.length,
      duration_ms: 0,
      at: match.decided_at,
    });
    return;
  }

  const chosen = request.candidates.find((c) => c.candidate_id === decision.candidate_id);
  if (!chosen) {
    applyEscalation(match, VIOLATION_RATIONALE);
    return;
  }

  match.tier = 'llm_adjudicated';
  match.ledger_ids = chosen.ledger_ids;
  match.gateway_ids = chosen.gateway_ids;
  match.bank_ids = chosen.bank_ids;
  match.reconciled_amount_paise = chosen.reconciled_amount_paise;
  match.variance_paise = chosen.variance_paise;
  match.evidence = [...match.evidence, ...chosen.evidence];

  for (const id of chosen.ledger_ids) state.openLedger.delete(id);
  for (const id of chosen.gateway_ids) state.openGateway.delete(id);
  for (const id of chosen.bank_ids) state.openBank.delete(id);

  const blocked = decision.exception_type !== null && EXCEPTION_DEFINITIONS[decision.exception_type].blocks_auto_clear;
  const withinTolerance = Math.abs(chosen.variance_paise) <= state.config.amount_tolerance_paise;
  match.status =
    decision.confidence >= state.config.auto_clear_threshold && withinTolerance && !blocked
      ? 'auto_cleared'
      : 'needs_review';

  match.stage_log.push({
    stage: 'stage4',
    outcome: 'matched',
    note: 'Model selected ' + chosen.candidate_id + ' at confidence ' + decision.confidence.toFixed(2) + '.',
    candidates_considered: request.candidates.length,
    duration_ms: 0,
    at: match.decided_at,
  });
}
