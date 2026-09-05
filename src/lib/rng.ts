/**
 * Seeded pseudo-random number generation.
 *
 * Determinism is a product feature (BUILD_SPEC P6): the same seed must produce
 * byte-identical datasets and byte-identical run output. Nothing in the
 * generator or the engine may call Math.random(). An Rng is always passed
 * explicitly, never held in module scope, because the *order* of draws is part
 * of the output.
 */

export type Rng = () => number;

/** mulberry32: small, fast, well-distributed 32-bit seeded PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent stream from a seed plus a label. */
export function streamFor(seed: number, label: string): Rng {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return mulberry32(h);
}

/** Integer in [min, max], inclusive at both ends. */
export function randomInt(rng: Rng, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new RangeError('randomInt bounds must be integers');
  }
  if (max < min) throw new RangeError('randomInt: max is less than min');
  return min + Math.floor(rng() * (max - min + 1));
}

/** Uniform choice from a non-empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: empty list');
  return items[randomInt(rng, 0, items.length - 1)] as T;
}

/**
 * Weighted choice. Weights need not sum to 1; they are normalised.
 * This is how the scenario mix table in BUILD_SPEC section 8 becomes code.
 */
export function weightedPick<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  if (entries.length === 0) throw new RangeError('weightedPick: empty list');
  let total = 0;
  for (const entry of entries) {
    if (entry[1] < 0) throw new RangeError('weightedPick: negative weight');
    total += entry[1];
  }
  if (total <= 0) throw new RangeError('weightedPick: weights sum to zero');

  let r = rng() * total;
  for (const entry of entries) {
    r -= entry[1];
    if (r < 0) return entry[0];
  }
  return entries[entries.length - 1]![0];
}

/** True with the given probability. */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Fisher-Yates. Returns a new array, leaves the input alone. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** Sample n distinct items without replacement. */
export function sample<T>(rng: Rng, items: readonly T[], n: number): T[] {
  if (n > items.length) throw new RangeError('sample: asked for more items than exist');
  return shuffle(rng, items).slice(0, n);
}

/**
 * Exact integer partition of `total` into `parts` positive pieces.
 * Used by split-payment generation so instalments sum to the invoice exactly.
 */
export function partitionInteger(rng: Rng, total: number, parts: number): number[] {
  if (parts < 1) throw new RangeError('partitionInteger: parts must be at least 1');
  if (total < parts) throw new RangeError('partitionInteger: total smaller than parts');
  if (parts === 1) return [total];

  const cuts = new Set<number>();
  let guard = 0;
  while (cuts.size < parts - 1 && guard < 10000) {
    cuts.add(randomInt(rng, 1, total - 1));
    guard++;
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: number[] = [];
  let prev = 0;
  for (const c of sorted) {
    out.push(c - prev);
    prev = c;
  }
  out.push(total - prev);
  return out;
}
