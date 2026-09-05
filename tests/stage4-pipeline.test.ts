import { beforeAll, describe, expect, it } from 'vitest';
import { executeRun } from '../src/run';
import { createAdjudicator, type LlmTransport } from '../src/adjudicator';
import { extractJson } from '../src/adjudicator/validate';
import { groupKey } from '../src/domain/types';
import { ingestDataset } from '../src/ingest';

/**
 * Stage 4 end to end without a network.
 *
 * The response cache is keyed on the prompt, not on who answered it, which is
 * right in production and wrong for a harness that swaps the transport between
 * cases. It is therefore off for most of this file, and exercised explicitly in
 * the cache test at the bottom.
 *
 * The wire call is the only part of the adjudicator that needs an API key.
 * Everything else - prompt construction, the four-check gate, the cache, and
 * how an accepted decision is written onto a match - runs here against scripted
 * responses, so the path is proven even though no model has been called.
 */

beforeAll(() => {
  process.env.SETTLED_LLM_CACHE = 'false';
  process.env.SETTLED_LLM_ENABLED = 'true';
});

/** Picks the top-ranked candidate out of the prompt it was given. */
function scriptedTransport(behaviour: 'accept_top' | 'no_match' | 'invent_candidate' | 'invent_amount' | 'prose'): LlmTransport {
  return async (_system, user) => {
    const firstId = /candidate_id: (CND-\d+)/.exec(user)?.[1] ?? 'CND-000000';
    const body = {
      accept_top: {
        decision: 'accept_candidate',
        candidate_id: firstId,
        exception_type: 'MERGED_PAYMENT',
        confidence: 0.93,
        rationale: 'The batch reference matched and the amount reconciles against this candidate.',
        evidence_ids: [],
      },
      no_match: {
        decision: 'no_match',
        candidate_id: null,
        exception_type: 'UNMATCHED_RESIDUAL',
        confidence: 0.3,
        rationale: 'None of the candidates reconciles to this credit within tolerance.',
        evidence_ids: [],
      },
      invent_candidate: {
        decision: 'accept_candidate',
        candidate_id: 'CND-999999',
        exception_type: 'MERGED_PAYMENT',
        confidence: 0.99,
        rationale: 'This candidate was never shown to the model in the prompt.',
        evidence_ids: [],
      },
      invent_amount: {
        decision: 'accept_candidate',
        candidate_id: firstId,
        exception_type: 'MERGED_PAYMENT',
        confidence: 0.95,
        rationale: 'The reconciled amount should be adjusted to the figure below.',
        evidence_ids: [],
        amount_paise: 4732000,
      },
      prose: null,
    }[behaviour];

    const raw = body === null ? 'I think the second candidate looks right, but I am not certain.' : JSON.stringify(body);
    return { raw, inputTokens: 1200, outputTokens: 150 };
  };
}

async function runWith(behaviour: Parameters<typeof scriptedTransport>[0]) {
  const adjudication = createAdjudicator('hybrid', scriptedTransport(behaviour));
  const artifact = await executeRun({
    dataset: 'standard',
    mode: 'hybrid',
    seed: 42,
    runId: 'S4-' + behaviour.toUpperCase(),
    adjudicator: adjudication.adjudicator,
    llmInteractions: adjudication.interactions,
  });
  return { artifact, interactions: adjudication.interactions };
}

describe('stage 4 runs end to end against a scripted transport', () => {
  it('builds prompts, calls out, and records an interaction per escalation', async () => {
    const { artifact, interactions } = await runWith('accept_top');
    expect(interactions.length).toBeGreaterThan(0);
    expect(artifact.run.metrics?.llm_calls).toBeGreaterThan(0);
    for (const call of interactions) {
      expect(call.system).toContain('reconciliation adjudicator');
      expect(call.user).toContain('UNMATCHED RECORD');
      expect(call.user).toContain('CANDIDATES');
      expect(call.prompt_hash.length).toBe(64);
    }
  });

  it('never lets the model originate a match outside its candidate list', async () => {
    const { artifact, interactions } = await runWith('invent_candidate');
    expect(interactions.every((call) => !call.valid)).toBe(true);
    expect(artifact.run.metrics?.llm_schema_violations).toBe(interactions.length);
    const adjudicated = artifact.matches.filter((m) => m.tier === 'llm_adjudicated');
    expect(adjudicated).toEqual([]);
  });

  it('rejects a response carrying an invented amount rather than stripping it', async () => {
    const { artifact, interactions } = await runWith('invent_amount');
    expect(interactions.every((call) => !call.valid)).toBe(true);
    expect(artifact.run.metrics?.llm_schema_violations).toBeGreaterThan(0);
    for (const call of interactions) {
      const parsed = extractJson(call.raw_response) as Record<string, unknown>;
      expect(parsed.amount_paise).toBe(4732000);
    }
    // The invented figure exists in the raw response and reaches no match.
    for (const match of artifact.matches) {
      expect(match.reconciled_amount_paise).not.toBe(4732000);
    }
  });

  it('handles prose with no JSON without crashing the run', async () => {
    const { artifact, interactions } = await runWith('prose');
    expect(artifact.run.status).toBe('complete');
    expect(interactions.every((call) => !call.valid)).toBe(true);
    for (const match of artifact.matches.filter((m) => m.llm_call_id !== null)) {
      expect(match.status).toBe('needs_review');
    }
  });

  it('records a no_match decision as an escalation, not a match', async () => {
    const { artifact } = await runWith('no_match');
    const adjudicated = artifact.matches.filter((m) => m.decided_by === 'llm');
    expect(adjudicated.length).toBeGreaterThan(0);
    expect(adjudicated.every((m) => m.status === 'needs_review')).toBe(true);
  });

  it('accepting a candidate only ever copies figures the rules computed', async () => {
    const { artifact } = await runWith('accept_top');
    const ing = ingestDataset('standard');
    const truthKeys = new Set(ing.groundTruth.entries.map(groupKey));
    const adjudicated = artifact.matches.filter((m) => m.tier === 'llm_adjudicated');
    expect(adjudicated.length).toBeGreaterThan(0);
    for (const match of adjudicated) {
      // Every amount on the match must trace to a candidate the engine built.
      const source = match.candidates?.find((c) => c.bank_ids.join() === match.bank_ids.join());
      if (source) expect(match.reconciled_amount_paise).toBe(source.reconciled_amount_paise);
      expect(Number.isSafeInteger(match.reconciled_amount_paise)).toBe(true);
    }
    expect(truthKeys.size).toBeGreaterThan(0);
  });

  it('is deterministic across two identical runs', async () => {
    const first = await runWith('accept_top');
    const second = await runWith('accept_top');
    expect(second.artifact.run.metrics?.output_hash).toBe(first.artifact.run.metrics?.output_hash);
  });

  it('serves the second run from cache and reports it separately from real calls', async () => {
    process.env.SETTLED_LLM_CACHE = 'true';
    const { getDb } = await import('../src/lib/db');
    getDb().prepare('DELETE FROM llm_cache').run();

    const cold = await runWith('accept_top');
    const warm = await runWith('accept_top');

    expect(cold.artifact.run.metrics?.llm_cache_hits).toBe(0);
    expect(cold.artifact.run.metrics?.llm_calls).toBeGreaterThan(0);
    expect(warm.artifact.run.metrics?.llm_cache_hits).toBe(cold.interactions.length);
    // Cache hits are not counted as real calls, so throughput is not overstated.
    expect(warm.artifact.run.metrics?.llm_calls).toBe(0);
    expect(warm.artifact.run.metrics?.output_hash).toBe(cold.artifact.run.metrics?.output_hash);

    process.env.SETTLED_LLM_CACHE = 'false';
  });
});
