/**
 * SQLite schema initialization for the escalation state store.
 *
 * Creates the `escalations` table with STRICT typing and configures
 * WAL mode for concurrent read/write access.
 */
import type Database from 'better-sqlite3';

/** Initialize the database with WAL mode and create the escalations table. */
export function initializeDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

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
