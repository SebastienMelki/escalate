/**
 * SQLite schema initialization for the escalation state store.
 *
 * Creates the `escalations` table with STRICT typing and configures
 * WAL mode for concurrent read/write access.
 */
import type { DatabaseSync } from 'node:sqlite';

/** Initialize the database with WAL mode and create the escalations table. */
export function initializeDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      event_type TEXT NOT NULL,
      request_json TEXT NOT NULL,
      response_json TEXT,
      fallback_action TEXT NOT NULL DEFAULT 'deny',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      timeout_at TEXT NOT NULL
    ) STRICT
  `);
}
