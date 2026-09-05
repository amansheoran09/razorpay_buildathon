/**
 * Normalisation helpers shared by all three parsers.
 *
 * Bank narration is the hardest input in the system. References are extracted
 * with an ordered set of patterns and ALL matches are kept, not just the first,
 * because the engine will try each in turn.
 */

export const REFERENCE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'invoice', pattern: /INV[-\s]?\d{4}[-\s]?\d{4,6}/gi },
  { name: 'order', pattern: /order[_-][A-Za-z0-9]{10,20}/g },
  { name: 'payment', pattern: /pay[_-][A-Za-z0-9]{10,20}/g },
  { name: 'settlement', pattern: /setl[_-][A-Za-z0-9]{10,20}/g },
  { name: 'alnum_token', pattern: /\b[A-Z0-9]{6,14}\b/g },
  { name: 'bare_numeric', pattern: /\b\d{6,12}\b/g },
];

/** Every reference-shaped token in a narration, in pattern priority order. */
export function extractReferences(narration: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { pattern } of REFERENCE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(narration)) !== null) {
      const token = m[0];
      if (!seen.has(token)) {
        seen.add(token);
        out.push(token);
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}

/** Uppercase, alphanumerics only. The comparison form for every reference. */
export function normalizeRef(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function refKeys(value: string): { full: string; last6: string } {
  const full = normalizeRef(value);
  return { full, last6: full.slice(-6) };
}

/** Levenshtein distance, capped for speed. Used for transposed references. */
export function editDistance(a: string, b: string, cap = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((cur[j - 1] as number) + 1, (prev[j] as number) + 1, (prev[j - 1] as number) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length] as number;
}

/** 0..1 similarity between two references, tolerant of suffixes and transposition. */
export function referenceSimilarity(a: string, b: string): number {
  const x = normalizeRef(a);
  const y = normalizeRef(b);
  if (x.length === 0 || y.length === 0) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  if (x.slice(-6) === y.slice(-6)) return 0.7;
  const d = editDistance(x, y, 4);
  if (d <= 2) return 0.75 - d * 0.1;
  const longer = Math.max(x.length, y.length);
  return Math.max(0, 1 - d / longer);
}

/** Token-set ratio for customer names. */
export function nameSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1 && !['PVT', 'LTD', 'LLP', 'AND', 'CO'].includes(t)),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

/** ISO date from either a date or a datetime string. */
export function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function daysApart(a: string, b: string): number {
  const pa = dateOnly(a).split('-').map(Number) as [number, number, number];
  const pb = dateOnly(b).split('-').map(Number) as [number, number, number];
  return Math.abs(
    Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000),
  );
}
