/**
 * Pure-function output builders for hook scripts.
 *
 * Each function translates a bridge poll result into the JSON output
 * Claude Code expects for the given event type. Returns null when the
 * script should exit without writing output (e.g., allow stop).
 */

import type { EscalationResult } from './bridge-client.js';

interface ParsedResponse {
  type?: unknown;
  actionId?: unknown;
  text?: unknown;
}

function parseResponse(result: EscalationResult): ParsedResponse | null {
  if (result.status === 'resolved' && result.responseJson) {
    return JSON.parse(result.responseJson) as ParsedResponse;
  }
  return null;
}

/** Build PermissionRequest hook output. Always returns JSON (allow or deny). */
export function buildPermissionRequestOutput(result: EscalationResult): string {
  const response = parseResponse(result);
  if (response && response.type === 'action' && response.actionId === 'approve') {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'Permission denied by user via Escalate' },
    },
  });
}

/** Build PreToolUse hook output. Always returns JSON (allow or deny). */
export function buildPreToolUseOutput(result: EscalationResult): string {
  const response = parseResponse(result);
  if (response && response.type === 'action' && response.actionId === 'approve') {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Blocked by user via Escalate',
    },
  });
}

/** Build Stop hook output. Returns JSON to block stop, or null to allow stop. */
export function buildStopOutput(result: EscalationResult): string | null {
  const response = parseResponse(result);
  if (response) {
    if (response.type === 'action' && response.actionId === 'continue') {
      return JSON.stringify({ decision: 'block', reason: 'User wants to continue via Escalate' });
    }
    if (response.type === 'text' && typeof response.text === 'string') {
      return JSON.stringify({ decision: 'block', reason: response.text });
    }
  }
  // Default: allow stop (no output)
  return null;
}

/** Build PostToolUseFailure hook output. Always returns notification JSON. */
export function buildPostToolFailureOutput(): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: 'User has been notified of this failure via Slack',
    },
  });
}
