import { describe, expect, it } from 'vitest';
import { validateAdjudication } from '../src/adjudicator/validate';

const CTX = {
  candidateIds: ['CND-000441', 'CND-000442'],
  recordIds: ['BNK-000217', 'LED-000012', 'GW-000031'],
};

const VALID = JSON.stringify({
  decision: 'accept_candidate',
  candidate_id: 'CND-000442',
  exception_type: 'MERGED_PAYMENT',
  confidence: 0.93,
  rationale: 'Batch reference matched with a suffix and the subset-sum was unique.',
  evidence_ids: ['BNK-000217', 'GW-000031'],
});

describe('the model output contract', () => {
  it('accepts a well-formed response', () => {
    const result = validateAdjudication(VALID, CTX);
    expect(result.ok).toBe(true);
  });

  it('tolerates prose wrapped around valid JSON', () => {
    const result = validateAdjudication('Here is my answer:\n' + VALID + '\nHope that helps.', CTX);
    expect(result.ok).toBe(true);
  });

  // The twelve adversarial responses required by BUILD_SPEC section 11.
  const adversarial: [string, string][] = [
    [
      'candidate id not in the prompt',
      JSON.stringify({ decision: 'accept_candidate', candidate_id: 'CND-999999', exception_type: 'MERGED_PAYMENT', confidence: 0.9, rationale: 'Looks like the right batch to me here.', evidence_ids: [] }),
    ],
    [
      'confidence out of range',
      JSON.stringify({ decision: 'accept_candidate', candidate_id: 'CND-000441', exception_type: 'TIMING_LAG', confidence: 1.4, rationale: 'Very confident about this particular match.', evidence_ids: [] }),
    ],
    [
      'invalid exception type',
      JSON.stringify({ decision: 'accept_candidate', candidate_id: 'CND-000441', exception_type: 'MONEY_VANISHED', confidence: 0.8, rationale: 'The money simply went missing somewhere.', evidence_ids: [] }),
    ],
    [
      'extra fields carrying an amount',
      JSON.stringify({ decision: 'accept_candidate', candidate_id: 'CND-000441', exception_type: 'TIMING_LAG', confidence: 0.8, rationale: 'Amount reconciles once the fee is added.', evidence_ids: [], amount_paise: 4732000 }),
    ],
    ['prose with no JSON at all', 'I think candidate two is correct because the reference matches.'],
    ['truncated JSON', '{"decision": "accept_candidate", "candidate_id": "CND-000441", "confidence": 0.9'],
    [
      'null decision',
      JSON.stringify({ decision: null, candidate_id: null, exception_type: 'TIMING_LAG', confidence: 0.5, rationale: 'I am not sure what to do with this.', evidence_ids: [] }),
    ],
    [
      'empty rationale',
      JSON.stringify({ decision: 'no_match', candidate_id: null, exception_type: 'UNMATCHED_RESIDUAL', confidence: 0.4, rationale: '', evidence_ids: [] }),
    ],
    [
      'evidence id not supplied in the prompt',
      JSON.stringify({ decision: 'accept_candidate', candidate_id: 'CND-000441', exception_type: 'TIMING_LAG', confidence: 0.9, rationale: 'Reference and amount both line up correctly.', evidence_ids: ['BNK-000999'] }),
    ],
    [
      'candidate_id set alongside no_match',
      JSON.stringify({ decision: 'no_match', candidate_id: 'CND-000441', exception_type: 'UNMATCHED_RESIDUAL', confidence: 0.3, rationale: 'Nothing here reconciles to the credit.', evidence_ids: [] }),
    ],
    [
      'confidence as a string',
      JSON.stringify({ decision: 'accept_candidate', candidate_id: 'CND-000441', exception_type: 'TIMING_LAG', confidence: '0.9', rationale: 'Reference and amount both line up correctly.', evidence_ids: [] }),
    ],
    [
      'nested object in place of the schema',
      JSON.stringify({ result: { decision: 'accept_candidate', candidate_id: 'CND-000441' } }),
    ],
  ];

  it.each(adversarial)('rejects %s', (_label, payload) => {
    const result = validateAdjudication(payload, CTX);
    expect(result.ok).toBe(false);
  });

  it('rejects all twelve without throwing', () => {
    const rejected = adversarial.filter(([, payload]) => !validateAdjudication(payload, CTX).ok);
    expect(rejected.length).toBe(12);
  });

  it('gives a specific reason for each rejection', () => {
    for (const [label, payload] of adversarial) {
      const result = validateAdjudication(payload, CTX);
      if (result.ok) throw new Error('expected rejection: ' + label);
      expect(result.reason.length).toBeGreaterThan(10);
    }
  });
});
