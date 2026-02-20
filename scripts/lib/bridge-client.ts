/**
 * Shared HTTP bridge client for hook scripts.
 *
 * Provides port discovery, escalation creation, and response polling.
 * All hook scripts import these functions to communicate with the HTTP bridge.
 *
 * CRITICAL: No console.log() -- only console.error() for debug logging.
 * Hook scripts own stdout for JSON output to Claude Code.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../src/config/loader.js';
import { DEFAULT_TIMEOUTS } from '../../src/config/defaults.js';

/** Event type keys corresponding to timeout configuration fields. */
export type TimeoutEventType = keyof typeof DEFAULT_TIMEOUTS;

/** Polling interval in milliseconds between response checks. */
export const POLL_INTERVAL_MS = 2000;

/** Timeout for individual fetch requests to prevent indefinite hangs. */
const FETCH_TIMEOUT_MS = 10_000;

/** Result returned by pollForResponse. */
export interface EscalationResult {
  status: string;
  responseJson?: string | null;
  fallbackAction?: string;
  [key: string]: unknown;
}

/**
 * Read the timeout (in milliseconds) for a given event type from config.
 *
 * Loads `escalate.config.json` from `$CLAUDE_PROJECT_DIR` (or cwd),
 * returning the configured timeout for the event type. Falls back to
 * `DEFAULT_TIMEOUTS` when the config file is missing or invalid.
 */
export function readTimeoutMs(eventType: TimeoutEventType): number {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const configPath = resolve(projectDir, 'escalate.config.json');
  const result = loadConfig(configPath);

  if (result.success) {
    return result.data.timeouts[eventType];
  }

  return DEFAULT_TIMEOUTS[eventType];
}

/**
 * Read the HTTP bridge port from the port file.
 *
 * Looks for `$CLAUDE_PROJECT_DIR/.claude/escalate-port`, falling back to
 * `process.cwd()/.claude/escalate-port` if the env var is not set.
 */
export function readPort(): number {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const portPath = join(projectDir, '.claude', 'escalate-port');
  const raw = readFileSync(portPath, 'utf-8').trim();
  const port = parseInt(raw, 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid port value in ${portPath}: "${raw}"`);
  }
  return port;
}

/**
 * Create a new escalation via the HTTP bridge.
 *
 * POSTs to the bridge server and returns the escalation ID and initial status.
 */
export async function createEscalation(
  port: number,
  params: {
    event_type: string;
    request_json: string;
    fallback_action?: string;
    timeout_seconds?: number;
  },
): Promise<{ escalation_id: string; status: string }> {
  const res = await fetch(`http://127.0.0.1:${String(port)}/escalations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return (await res.json()) as { escalation_id: string; status: string };
}

/**
 * Poll the HTTP bridge until the escalation is resolved or times out.
 *
 * Checks every POLL_INTERVAL_MS milliseconds. Returns the escalation record
 * when status changes from 'pending', or returns `{ status: 'timed_out' }`
 * when the deadline expires.
 */
export async function pollForResponse(
  port: number,
  escalationId: string,
  timeoutMs: number = 600_000,
): Promise<EscalationResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(
      `http://127.0.0.1:${String(port)}/escalations/${escalationId}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const data = (await res.json()) as EscalationResult;

    if (data.status !== 'pending') {
      return data;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { status: 'timed_out' };
}

/**
 * Dismiss an escalation's Slack message (update it to show resolved status).
 *
 * Called when the escalation is resolved outside Slack (e.g. from CLI or timeout).
 * Best-effort: callers should catch errors.
 */
export async function dismissEscalation(
  port: number,
  escalationId: string,
  source: string = 'cli',
): Promise<void> {
  await fetch(
    `http://127.0.0.1:${String(port)}/escalations/${escalationId}/dismiss`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
}

/**
 * Request a session summary from the HTTP bridge.
 *
 * POSTs to /summary and returns the status. Best-effort -- callers should
 * catch errors rather than letting them propagate.
 */
export async function requestSummary(port: number): Promise<{ status: string }> {
  const res = await fetch(`http://127.0.0.1:${String(port)}/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return (await res.json()) as { status: string };
}

/** Path to the last-escalation-id handoff file. */
function lastEscalationIdPath(): string {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  return join(projectDir, '.claude', 'escalate-last-id');
}

/**
 * Write an escalation ID to a temp file for PostToolUse handoff.
 *
 * The PreToolUse/PermissionRequest hook writes this after a successful
 * resolution so the PostToolUse hook can pick it up.
 */
export function writeLastEscalationId(escalationId: string): void {
  writeFileSync(lastEscalationIdPath(), escalationId, 'utf-8');
}

/**
 * Read and delete the last escalation ID file.
 *
 * Returns the ID if the file exists, null otherwise. The file is deleted
 * after reading to prevent stale IDs from being reused.
 */
export function readLastEscalationId(): string | null {
  const filePath = lastEscalationIdPath();
  try {
    const id = readFileSync(filePath, 'utf-8').trim();
    unlinkSync(filePath);
    return id || null;
  } catch {
    return null;
  }
}

/**
 * Post tool output to an escalation's Slack thread via the HTTP bridge.
 *
 * Best-effort: callers should catch errors.
 */
export async function postResult(
  port: number,
  escalationId: string,
  output: string,
): Promise<void> {
  await fetch(
    `http://127.0.0.1:${String(port)}/escalations/${escalationId}/result`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
}
