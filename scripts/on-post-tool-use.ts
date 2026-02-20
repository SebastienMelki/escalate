#!/usr/bin/env node
/**
 * PostToolUse hook — posts tool output to the escalation's Slack thread.
 *
 * Fire-and-forget: runs async so it does not block Claude Code.
 * Reads the escalation ID written by the PreToolUse/PermissionRequest hook,
 * extracts tool output from stdin, and posts it to the HTTP bridge.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, readLastEscalationId, postResult } from './lib/bridge-client.js';

async function main(): Promise<void> {
  const escalationId = readLastEscalationId();
  if (!escalationId) process.exit(0); // No recent escalation

  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;

  // Extract tool output — PostToolUse hooks provide output in 'tool_response'.
  // For Bash, tool_response is { stdout, stderr, interrupted, ... }. Extract the useful parts.
  const toolResponse = input['tool_response'];
  let output = '';
  if (typeof toolResponse === 'object' && toolResponse !== null) {
    const resp = toolResponse as Record<string, unknown>;
    const stdout = typeof resp['stdout'] === 'string' ? resp['stdout'] : '';
    const stderr = typeof resp['stderr'] === 'string' ? resp['stderr'] : '';
    output = stdout || stderr || '';
  } else if (typeof toolResponse === 'string') {
    output = toolResponse;
  }

  if (!output) process.exit(0);

  const port = readPort();
  await postResult(port, escalationId, output).catch(() => {});
  process.exit(0);
}

main().catch(() => process.exit(0));
