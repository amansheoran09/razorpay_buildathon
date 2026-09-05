/**
 * The validation gate (BUILD_SPEC section 11).
 *
 * Four checks, in order, all must pass. A failure is not an error state - it
 * is a normal, counted outcome that routes the item to a human. The count is
 * displayed in the UI rather than hidden.
 */

import { AdjudicationSchema, type Adjudication } from '../domain/schema';

export type ValidationResult =
  | { ok: true; value: Adjudication }
  | { ok: false; reason: string; stage: 'schema' | 'candidate_membership' | 'evidence_membership' | 'consistency' | 'parse' };

export interface ValidationContext {
  candidateIds: string[];
  recordIds: string[];
}

const BACKSLASH = String.fromCharCode(92);

/** Extract the first balanced JSON object from a response that may carry prose. */
export function extractJson(raw: string): unknown | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === BACKSLASH) escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function validateAdjudication(raw: string, ctx: ValidationContext): ValidationResult {
  const parsed = extractJson(raw);
  if (parsed === null) {
    return { ok: false, reason: 'Response contained no parseable JSON object.', stage: 'parse' };
  }

  // 1. Schema
  const schema = AdjudicationSchema.safeParse(parsed);
  if (!schema.success) {
    const first = schema.error.issues[0];
    return {
      ok: false,
      reason: 'Schema: ' + (first ? first.path.join('.') + ' ' + first.message : 'invalid shape'),
      stage: 'schema',
    };
  }
  const value = schema.data;

  // 2. Candidate membership
  if (value.decision === 'accept_candidate') {
    if (value.candidate_id === null) {
      return { ok: false, reason: 'Accepted a candidate but returned a null candidate_id.', stage: 'candidate_membership' };
    }
    if (!ctx.candidateIds.includes(value.candidate_id)) {
      return {
        ok: false,
        reason: 'Named candidate ' + value.candidate_id + ', which was not in the prompt.',
        stage: 'candidate_membership',
      };
    }
  }

  // 3. Evidence membership
  const allowed = new Set([...ctx.recordIds, ...ctx.candidateIds]);
  for (const id of value.evidence_ids) {
    if (!allowed.has(id)) {
      return { ok: false, reason: 'Cited evidence ' + id + ', which was not supplied in the prompt.', stage: 'evidence_membership' };
    }
  }

  // 4. Consistency
  if (value.decision !== 'accept_candidate' && value.candidate_id !== null) {
    return {
      ok: false,
      reason: 'Returned ' + value.decision + ' but still named candidate ' + value.candidate_id + '.',
      stage: 'consistency',
    };
  }

  return { ok: true, value };
}

export const VIOLATION_RATIONALE = 'Model response failed validation; escalated for review.';
