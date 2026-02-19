#!/usr/bin/env node
/**
 * PreToolUse hook — escalates dangerous tool invocations to Slack for human approval.
 *
 * Matched against Bash|Write|Edit tools via hooks.json matcher.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, pollForResponse } from './lib/bridge-client.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;
  const port = readPort();

  const esc = await createEscalation(port, {
    event_type: 'PreToolUse',
    request_json: JSON.stringify(input),
    fallback_action: 'deny',
    timeout_seconds: 300,
  });

  const result = await pollForResponse(port, esc.escalation_id);

  if (result.status === 'resolved' && result.responseJson) {
    const response = JSON.parse(result.responseJson) as Record<string, unknown>;
    if (response['type'] === 'action' && response['actionId'] === 'approve') {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
        }),
      );
      process.exit(0);
    }
  }

  // Default: deny
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Blocked by user via Escalate',
      },
    }),
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
