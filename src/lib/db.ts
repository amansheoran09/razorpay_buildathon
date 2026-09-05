/** SQLite connection and migrations (BUILD_SPEC section 12). */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    metrics_json TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS records (
    record_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    source TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (run_id, record_id)
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
    match_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    confidence REAL NOT NULL,
    status TEXT NOT NULL,
    exception_type TEXT,
    variance_paise INTEGER NOT NULL,
    reconciled_amount_paise INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (run_id, match_id)
  )`,
  `CREATE TABLE IF NOT EXISTS llm_cache (
    prompt_hash TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    response_json TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS human_decisions (
    decision_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reassigned_candidate_id TEXT,
    note TEXT,
    decided_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_exception ON matches(run_id, exception_type)`,
];

export type SettledDb = Database.Database;

let cached: SettledDb | null = null;

export function dbPath(root = process.cwd()): string {
  return join(root, 'data', 'settled.db');
}

export function getDb(root = process.cwd()): SettledDb {
  if (cached) return cached;
  const path = dbPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  for (const statement of SCHEMA) db.exec(statement);
  cached = db;
  return db;
}

export function closeDb(): void {
  cached?.close();
  cached = null;
}
