/**
 * In-memory progress for the SSE stream. A run is short-lived and the artifact
 * on disk is the durable record, so this deliberately does not persist.
 */

export interface ProgressEvent {
  stage: string;
  processed: number;
  total: number;
  elapsed_ms: number;
  records_per_second: number;
}

interface RunProgress {
  startedAt: number;
  events: ProgressEvent[];
  done: boolean;
  error: string | null;
}

const runs = new Map<string, RunProgress>();

export function recordProgress(runId: string, event: { stage: string; processed: number; total: number }): void {
  let entry = runs.get(runId);
  if (!entry) {
    entry = { startedAt: Date.now(), events: [], done: false, error: null };
    runs.set(runId, entry);
  }
  const elapsed = Date.now() - entry.startedAt;
  entry.events.push({
    ...event,
    elapsed_ms: elapsed,
    records_per_second: elapsed === 0 ? 0 : Math.round((event.processed / (elapsed / 1000)) * 10) / 10,
  });
}

export function finishProgress(runId: string, error: string | null): void {
  const entry = runs.get(runId);
  if (entry) {
    entry.done = true;
    entry.error = error;
  } else {
    runs.set(runId, { startedAt: Date.now(), events: [], done: true, error });
  }
}

export function readProgress(runId: string, from: number): { events: ProgressEvent[]; done: boolean; error: string | null } {
  const entry = runs.get(runId);
  if (!entry) return { events: [], done: false, error: null };
  return { events: entry.events.slice(from), done: entry.done, error: entry.error };
}
