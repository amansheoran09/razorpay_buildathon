/**
 * SQLite persistence (BUILD_SPEC section 12).
 *
 * The JSON artifact in runs/ is the portable record; the database is what the
 * running app queries. Both are written on every run so a match round-trips
 * through either one without loss.
 */

import { getDb } from './db';
import type { MatchGroup, RunArtifact, SourceRecord } from '../domain/types';

export function persistRun(artifact: RunArtifact): void {
  const db = getDb();
  const runId = artifact.run.run_id;

  const insertRun = db.prepare(
    'INSERT OR REPLACE INTO runs (run_id, config_json, started_at, finished_at, status, metrics_json, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertRecord = db.prepare(
    'INSERT OR REPLACE INTO records (record_id, run_id, source, payload_json) VALUES (?, ?, ?, ?)',
  );
  const insertMatch = db.prepare(
    'INSERT OR REPLACE INTO matches (match_id, run_id, tier, confidence, status, exception_type, variance_paise, reconciled_amount_paise, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  const write = db.transaction(() => {
    db.prepare('DELETE FROM records WHERE run_id = ?').run(runId);
    db.prepare('DELETE FROM matches WHERE run_id = ?').run(runId);

    insertRun.run(
      runId,
      JSON.stringify(artifact.run.config),
      artifact.run.started_at,
      artifact.run.finished_at,
      artifact.run.status,
      artifact.run.metrics ? JSON.stringify(artifact.run.metrics) : null,
      artifact.run.error,
    );

    const all: SourceRecord[] = [
      ...artifact.records.ledger,
      ...artifact.records.gateway,
      ...artifact.records.bank,
    ];
    for (const record of all) {
      insertRecord.run(record.record_id, runId, record.source, JSON.stringify(record));
    }

    for (const match of artifact.matches) {
      insertMatch.run(
        match.match_id,
        runId,
        match.tier,
        match.confidence,
        match.status,
        match.exception_type,
        match.variance_paise,
        match.reconciled_amount_paise,
        JSON.stringify(match),
      );
    }
  });

  write();
}

export function runExists(runId: string): boolean {
  const row = getDb().prepare('SELECT 1 AS present FROM runs WHERE run_id = ?').get(runId);
  return row !== undefined;
}

export interface MatchQuery {
  status?: string;
  exception_type?: string;
  min_confidence?: number;
  sort?: 'amount' | 'confidence' | 'variance';
  cursor?: number;
  limit?: number;
}

/** Query matches out of the database, as BUILD_SPEC section 14 specifies. */
export function queryMatches(runId: string, query: MatchQuery): { matches: MatchGroup[]; next_cursor: number | null; total: number } {
  const where: string[] = ['run_id = ?'];
  const args: (string | number)[] = [runId];

  if (query.status) {
    where.push('status = ?');
    args.push(query.status);
  }
  if (query.exception_type) {
    where.push('exception_type = ?');
    args.push(query.exception_type);
  }
  if (query.min_confidence !== undefined) {
    where.push('confidence >= ?');
    args.push(query.min_confidence);
  }

  const order =
    query.sort === 'confidence'
      ? 'confidence ASC'
      : query.sort === 'variance'
        ? 'ABS(variance_paise) DESC'
        : 'reconciled_amount_paise DESC';

  const clause = where.join(' AND ');
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM matches WHERE ' + clause).get(...args) as { n: number }).n;

  const limit = Math.min(query.limit ?? 100, 500);
  const cursor = query.cursor ?? 0;
  const rows = db
    .prepare('SELECT payload_json FROM matches WHERE ' + clause + ' ORDER BY ' + order + ', match_id ASC LIMIT ? OFFSET ?')
    .all(...args, limit, cursor) as { payload_json: string }[];

  return {
    matches: rows.map((row) => JSON.parse(row.payload_json) as MatchGroup),
    next_cursor: cursor + rows.length < total ? cursor + rows.length : null,
    total,
  };
}

export interface HumanDecisionRow {
  decision_id: string;
  run_id: string;
  match_id: string;
  action: string;
  reassigned_candidate_id: string | null;
  note: string | null;
  decided_at: string;
}

export function decisionsForRun(runId: string): HumanDecisionRow[] {
  return getDb()
    .prepare('SELECT * FROM human_decisions WHERE run_id = ? ORDER BY decided_at')
    .all(runId) as HumanDecisionRow[];
}

export function decisionsForMatch(matchId: string): HumanDecisionRow[] {
  return getDb()
    .prepare('SELECT * FROM human_decisions WHERE match_id = ? ORDER BY decided_at')
    .all(matchId) as HumanDecisionRow[];
}
