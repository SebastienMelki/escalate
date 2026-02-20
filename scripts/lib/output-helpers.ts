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

/**
 * Check if the response is an approval decision.
 * Both button clicks (type:'action') and emoji reactions (type:'reaction') carry actionId.
 */
function isApprovalDecision(response: ParsedResponse): boolean {
  return (
    (response.type === 'action' || response.type === 'reaction') && response.actionId === 'approve'
  );
}

/**
 * Check if the response is a snooze decision.
 * Both button clicks (type:'action') and emoji reactions (type:'reaction') carry actionId.
 */
function isSnoozeDecision(response: ParsedResponse): boolean {
  return (
    (response.type === 'action' || response.type === 'reaction') && response.actionId === 'snooze'
  );
}

/**
 * Check if the response indicates "continue" for Stop hooks.
 * Both button clicks and emoji reactions can map to the 'continue' actionId.
 */
function isContinueDecision(response: ParsedResponse): boolean {
  return (
    (response.type === 'action' || response.type === 'reaction') &&
    response.actionId === 'continue'
  );
}

/**
 * Extract user text from text or voice responses.
 * Voice notes carry transcribed text, thread replies carry typed text.
 * Returns null if no text content is available.
 */
function extractText(response: ParsedResponse): string | null {
  if (
    (response.type === 'text' || response.type === 'voice') &&
    typeof response.text === 'string'
  ) {
    return response.text;
  }
  return null;
}

/** Build PermissionRequest hook output. Always returns JSON (allow or deny). */
export function buildPermissionRequestOutput(result: EscalationResult): string {
  const response = parseResponse(result);
  if (response && isApprovalDecision(response)) {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  }
  if (response && isSnoozeDecision(response)) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Snoozed by user via Escalate' },
      },
    });
  }
  // Voice notes without actionId default to deny (conservative)
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
  if (response && isApprovalDecision(response)) {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
  }
  if (response && isSnoozeDecision(response)) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Snoozed by user via Escalate',
      },
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
    if (isContinueDecision(response)) {
      return JSON.stringify({ decision: 'block', reason: 'User wants to continue via Escalate' });
    }
    const text = extractText(response);
    if (text) {
      return JSON.stringify({ decision: 'block', reason: text });
    }
  }
  // Default: allow stop (no output)
  return null;
}

/**
 * Build PermissionRequest hook output for AskUserQuestion tool calls.
 *
 * Always denies the tool call, embedding the user's answer in the deny message.
 * Claude reads the deny message, understands the answer, and continues without
 * re-asking.
 *
 * Button clicks (option_N) are mapped back to the actual option label/description.
 * Thread replies are passed through as freeform text.
 */
export function buildAskUserQuestionOutput(
  result: EscalationResult,
  toolInput: Record<string, unknown>,
): string {
  const response = parseResponse(result);
  if (!response) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'No answer received via Escalate' },
      },
    });
  }

  // Button click: option_N → look up actual option
  if (
    (response.type === 'action' || response.type === 'reaction') &&
    typeof response.actionId === 'string' &&
    response.actionId.startsWith('option_')
  ) {
    const idx = parseInt(response.actionId.split('_')[1] ?? '', 10);
    const questions = (toolInput as Record<string, unknown>)['questions'];
    const options = Array.isArray(questions)
      ? ((questions[0] as Record<string, unknown> | undefined)?.['options'] as Array<Record<string, unknown>> | undefined)
      : undefined;
    const selected = Array.isArray(options) ? options[idx] : undefined;

    const label = typeof selected?.['label'] === 'string' ? selected['label'] : response.actionId;
    const desc = typeof selected?.['description'] === 'string' ? (selected['description'] as string) : undefined;
    const answer = desc ? `${label} — ${desc}` : label;

    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: `User answered via Slack: ${answer}` },
      },
    });
  }

  // Thread reply (freeform text or voice)
  const text = extractText(response);
  if (text) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: `User answered via Slack: ${text}` },
      },
    });
  }

  // Fallback
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'No answer received via Escalate' },
    },
  });
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
