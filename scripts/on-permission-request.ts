#!/usr/bin/env node
/**
 * PermissionRequest hook — escalates permission requests to Slack for human approval.
 *
 * Reads stdin JSON, creates escalation, polls for response, outputs allow/deny decision.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, pollForResponse } from './lib/bridge-client.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;
  const port = readPort();

  const esc = await createEscalation(port, {
    event_type: 'PermissionRequest',
    request_json: JSON.stringify(input),
    fallback_action: 'deny',
    timeout_seconds: 600,
  });

  const result = await pollForResponse(port, esc.escalation_id);

  if (result.status === 'resolved' && result.responseJson) {
    const response = JSON.parse(result.responseJson) as Record<string, unknown>;
    if (response['type'] === 'action' && response['actionId'] === 'approve') {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
        }),
      );
      process.exit(0);
    }
  }

  // Default: deny
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Permission denied by user via Escalate' },
      },
    }),
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
