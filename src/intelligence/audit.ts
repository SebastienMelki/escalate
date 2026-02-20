/**
 * Append-only JSONL audit log writer and reader.
 *
 * Every escalation decision is recorded as a single JSON line in the audit log.
 * The log is append-only -- entries are never modified or deleted. This provides
 * a transparent, inspectable record of all decisions made during a session.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A single audit log entry recording one escalation decision. */
export interface AuditEntry {
  readonly timestamp: string;
  readonly eventType: string;
  readonly toolName?: string;
  readonly filePaths?: readonly string[];
  readonly decision:
    | 'escalated'
    | 'auto_approved'
    | 'quiet_hours_suppressed'
    | 'timed_out';
  readonly reason: string;
  readonly matchedRule?: string;
  readonly messagePreview?: string;
  readonly responseJson?: string;
  readonly escalationId?: string;
  readonly triageMethod?: 'llm' | 'heuristic';
  readonly triageConfidence?: 'high' | 'medium' | 'low';
  readonly triageNeedsHumanInput?: boolean;
}

/**
 * Appends a single audit entry as a JSON line to the log file.
 *
 * Creates parent directories if they do not exist. Each entry is written
 * as a single line terminated by `\n` for JSONL compatibility.
 */
export function appendAuditEntry(logPath: string, entry: AuditEntry): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Reads all audit entries from a JSONL log file.
 *
 * Returns an empty array if the file does not exist. Skips empty lines
 * for robustness against trailing newlines.
 */
export function readAuditLog(logPath: string): AuditEntry[] {
  if (!existsSync(logPath)) {
    return [];
  }
  const content = readFileSync(logPath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEntry);
}
