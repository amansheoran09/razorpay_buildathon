/**
 * Stable hashing.
 *
 * The determinism claim is only checkable if the whole output can be reduced
 * to one comparable string. JSON.stringify serialises keys in insertion order,
 * so two structurally identical objects built in a different order would hash
 * differently. Keys are therefore sorted recursively before hashing.
 */

import { createHash } from 'node:crypto';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Deterministic JSON: object keys sorted recursively, arrays left in order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value === 0 ? 0 : value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: { [k: string]: Json } = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue;
      out[key] = normalize(src[key]);
    }
    return out;
  }
  return String(value);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash any object structurally. Key order and negative zero cannot affect it. */
export function hashObject(value: unknown): string {
  return sha256(stableStringify(value));
}

/** Short display form for the UI. */
export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}

/** Prompt cache key. BUILD_SPEC section 11: system + user + model + temperature. */
export function promptHash(parts: {
  system: string;
  user: string;
  model: string;
  temperature: number | null;
}): string {
  return hashObject(parts);
}
