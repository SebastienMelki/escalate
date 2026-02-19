/**
 * SQLite-backed escalation state store.
 *
 * Provides CRUD operations for escalation records using better-sqlite3.
 * All operations are synchronous (better-sqlite3 is sync by design).
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { initializeDatabase } from './schema.js';
import type { EscalationRecord, CreateEscalationParams, FallbackAction } from './types.js';

/** Raw row shape from SQLite (snake_case column names). */
interface EscalationRow {
  id: string;
  status: string;
  event_type: string;
  request_json: string;
  response_json: string | null;
  fallback_action: string;
  created_at: string;
  resolved_at: string | null;
  timeout_at: string;
}

/** Map a raw SQLite row to an EscalationRecord. */
function rowToRecord(row: EscalationRow): EscalationRecord {
  return {
    id: row.id,
    status: row.status as EscalationRecord['status'],
    eventType: row.event_type,
    requestJson: row.request_json,
    responseJson: row.response_json,
    fallbackAction: row.fallback_action as FallbackAction,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    timeoutAt: row.timeout_at,
  };
}

/** CRUD operations for escalation state stored in SQLite. */
export class EscalationStore {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly resolveStmt: Database.Statement;
  private readonly checkTimeoutStmt: Database.Statement;
  private readonly markTimedOutStmt: Database.Statement;
  private readonly getPendingStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    initializeDatabase(db);

    this.insertStmt = this.db.prepare(`
      INSERT INTO escalations (id, status, event_type, request_json, fallback_action, created_at, timeout_at)
      VALUES (?, 'pending', ?, ?, ?, datetime('now'), datetime('now', '+' || ? || ' seconds'))
    `);

    this.getByIdStmt = this.db.prepare(`
      SELECT id, status, event_type, request_json, response_json, fallback_action, created_at, resolved_at, timeout_at
      FROM escalations WHERE id = ?
    `);

    this.resolveStmt = this.db.prepare(`
      UPDATE escalations
      SET status = 'resolved', response_json = ?, resolved_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `);

    this.checkTimeoutStmt = this.db.prepare(`
      SELECT fallback_action FROM escalations
      WHERE id = ? AND status = 'pending' AND timeout_at < datetime('now')
    `);

    this.markTimedOutStmt = this.db.prepare(`
      UPDATE escalations SET status = 'timed_out'
      WHERE id = ? AND status = 'pending'
    `);

    this.getPendingStmt = this.db.prepare(`
      SELECT id, status, event_type, request_json, response_json, fallback_action, created_at, resolved_at, timeout_at
      FROM escalations WHERE status = 'pending' ORDER BY created_at ASC
    `);
  }

  /** Create a new pending escalation and return the inserted record. */
  create(params: CreateEscalationParams): EscalationRecord {
    const id = randomUUID();
    this.insertStmt.run(
      id,
      params.eventType,
      params.requestJson,
      params.fallbackAction,
      params.timeoutSeconds,
    );
    const record = this.getById(id);
    if (!record) {
      throw new Error(`Failed to retrieve escalation after insert: ${id}`);
    }
    return record;
  }

  /** Get an escalation by its ID, or undefined if not found. */
  getById(id: string): EscalationRecord | undefined {
    const row = this.getByIdStmt.get(id) as EscalationRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** Resolve a pending escalation. Returns true if resolved, false if not found or already resolved. */
  resolve(id: string, responseJson: string): boolean {
    const result = this.resolveStmt.run(responseJson, id);
    return result.changes > 0;
  }

  /**
   * Check if an escalation has timed out.
   * If timed out, marks status as 'timed_out' and returns the fallback action.
   * Returns null if not timed out, not found, or not pending.
   */
  checkTimeout(id: string): FallbackAction | null {
    const row = this.checkTimeoutStmt.get(id) as { fallback_action: string } | undefined;
    if (!row) return null;
    this.markTimedOutStmt.run(id);
    return row.fallback_action as FallbackAction;
  }

  /** Get all pending escalations ordered by creation time (oldest first). */
  getPending(): EscalationRecord[] {
    const rows = this.getPendingStmt.all() as EscalationRow[];
    return rows.map(rowToRecord);
  }
}
