/**
 * Bounded subset-sum over integer paise.
 *
 * Depth-first with suffix-sum pruning. Enumeration stops as soon as a second
 * distinct solution is found, because ambiguity is a result in its own right:
 * silently picking one of two arithmetically valid subsets is the failure mode
 * that destroys trust in a reconciliation tool (BUILD_SPEC section 10).
 */

export interface SubsetItem {
  id: string;
  value: number;
}

export interface SubsetSolution {
  ids: string[];
  total: number;
  variance: number;
}

export interface SubsetResult {
  solutions: SubsetSolution[];
  ambiguous: boolean;
  nodesVisited: number;
  exhausted: boolean;
}

export function findSubsets(
  items: SubsetItem[],
  target: number,
  options: { tolerance: number; maxSize: number; maxSolutions?: number; nodeBudget?: number },
): SubsetResult {
  const maxSolutions = options.maxSolutions ?? 2;
  const nodeBudget = options.nodeBudget ?? 250_000;

  // Descending order makes the suffix-sum bound bite early.
  const sorted = items.slice().sort((a, b) => (b.value === a.value ? (a.id < b.id ? -1 : 1) : b.value - a.value));
  const n = sorted.length;

  const suffix = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffix[i] = (suffix[i + 1] as number) + (sorted[i] as SubsetItem).value;

  const solutions: SubsetSolution[] = [];
  const seen = new Set<string>();
  const chosen: number[] = [];
  let nodes = 0;
  let exhausted = true;

  const lo = target - options.tolerance;
  const hi = target + options.tolerance;

  function record(total: number): void {
    const ids = chosen.map((i) => (sorted[i] as SubsetItem).id).slice().sort();
    const key = ids.join('|');
    if (seen.has(key)) return;
    seen.add(key);
    solutions.push({ ids, total, variance: target - total });
  }

  function dfs(index: number, current: number): void {
    if (solutions.length >= maxSolutions) return;
    if (++nodes > nodeBudget) {
      exhausted = false;
      return;
    }
    if (current >= lo && current <= hi && chosen.length > 0) {
      record(current);
      return;
    }
    if (current > hi) return;
    if (chosen.length >= options.maxSize) return;
    if (index >= n) return;
    if (current + (suffix[index] as number) < lo) return;

    for (let i = index; i < n; i++) {
      if (solutions.length >= maxSolutions || nodes > nodeBudget) return;
      // Equal values are NOT interchangeable here: two different record sets
      // that both sum correctly is exactly the ambiguity we must surface.
      const value = (sorted[i] as SubsetItem).value;
      if (current + value > hi) continue;
      chosen.push(i);
      dfs(i + 1, current + value);
      chosen.pop();
    }
  }

  dfs(0, 0);

  return {
    solutions,
    ambiguous: solutions.length > 1,
    nodesVisited: nodes,
    exhausted,
  };
}
