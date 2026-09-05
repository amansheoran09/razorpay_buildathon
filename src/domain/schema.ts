/**
 * The LLM output contract (BUILD_SPEC section 11).
 *
 * There is deliberately no field in which an amount, an account number, a date
 * or a new record ID can be returned. That is the whole point: the model
 * cannot hallucinate money into these books because the schema gives it
 * nowhere to put one.
 */

import { z } from 'zod';
import { EXCEPTION_TYPES } from './taxonomy';

/**
 * Strict on purpose. Zod strips unknown keys by default, which would let a
 * response carrying an invented "amount_paise" pass validation with the field
 * silently discarded. The contract is that such a response is rejected and
 * counted, so the object is closed.
 */
export const AdjudicationSchema = z.strictObject({
  decision: z.enum(['accept_candidate', 'no_match', 'insufficient_evidence']),
  candidate_id: z.string().nullable(),
  exception_type: z.enum(EXCEPTION_TYPES),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(10).max(240),
  evidence_ids: z.array(z.string()).max(20),
});

export type Adjudication = z.infer<typeof AdjudicationSchema>;

/** JSON Schema form, for the structured-output request parameter. */
export const ADJUDICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'candidate_id', 'exception_type', 'confidence', 'rationale', 'evidence_ids'],
  properties: {
    decision: { type: 'string', enum: ['accept_candidate', 'no_match', 'insufficient_evidence'] },
    candidate_id: { type: ['string', 'null'] },
    exception_type: { type: 'string', enum: [...EXCEPTION_TYPES] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string', minLength: 10, maxLength: 240 },
    evidence_ids: { type: 'array', items: { type: 'string' }, maxItems: 20 },
  },
} as const;

export const RunConfigSchema = z.object({
  dataset: z.enum(['standard', 'hard']),
  mode: z.enum(['hybrid', 'rules_only', 'llm_only']),
  seed: z.number().int(),
});

export const HumanDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reassign']),
  reassigned_candidate_id: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
