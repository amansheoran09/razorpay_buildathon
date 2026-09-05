/**
 * Prompt-hash response cache (BUILD_SPEC section 11).
 *
 * Keyed on sha256(system + user + model + temperature). Makes re-runs instant,
 * makes the demo survive a dead venue wifi, and makes determinism testable.
 * Cache hits are counted separately from real calls so throughput figures are
 * not misleading: both cold and warm numbers are reported.
 */

import { getDb } from '../lib/db';
import { promptHash } from '../lib/hash';

export interface CachedResponse {
  raw: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CacheKeyParts {
  system: string;
  user: string;
  model: string;
  temperature: number | null;
}

export function keyFor(parts: CacheKeyParts): string {
  return promptHash(parts);
}

export function readCache(hash: string): CachedResponse | null {
  const row = getDb()
    .prepare('SELECT response_json, input_tokens, output_tokens FROM llm_cache WHERE prompt_hash = ?')
    .get(hash) as { response_json: string; input_tokens: number; output_tokens: number } | undefined;
  if (!row) return null;
  return { raw: row.response_json, inputTokens: row.input_tokens, outputTokens: row.output_tokens };
}

export function writeCache(hash: string, model: string, response: CachedResponse): void {
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO llm_cache (prompt_hash, model, response_json, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(hash, model, response.raw, response.inputTokens, response.outputTokens, new Date().toISOString());
}

export function cacheSize(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM llm_cache').get() as { n: number };
  return row.n;
}
