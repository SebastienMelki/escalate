#!/usr/bin/env node
/**
 * Stop hook — escalates stop events to Slack so user can continue or allow stop.
 *
 * Checks stop_hook_active to prevent infinite loops (re-stop after block).
 * When the process is killed (user approved from CLI), dismisses the Slack message.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, pollForResponse, dismissEscalation, readTimeoutMs } from './lib/bridge-client.js';
import { buildStopOutput } from './lib/output-helpers.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;

  // Prevent infinite loop: if stop_hook_active, this is a re-stop. Allow it.
  if (input['stop_hook_active']) {
    process.exit(0);
  }

  const port = readPort();
  const timeoutMs = readTimeoutMs('stop');

  const esc = await createEscalation(port, {
    event_type: 'Stop',
    request_json: JSON.stringify(input),
    fallback_action: 'allow',
    timeout_seconds: Math.ceil(timeoutMs / 1000),
  });

  // Register cleanup: if process is killed, update Slack message
  const cleanup = (): void => {
    dismissEscalation(port, esc.escalation_id, 'cli')
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  const result = await pollForResponse(port, esc.escalation_id, timeoutMs);

  // If timed out, update Slack message
  if (result.status === 'timed_out') {
    await dismissEscalation(port, esc.escalation_id, 'timeout').catch(() => {});
  }

  // Remove signal handlers (resolved normally, no need for cleanup)
  process.removeListener('SIGTERM', cleanup);
  process.removeListener('SIGINT', cleanup);

  const output = buildStopOutput(result);
  if (output) {
    process.stdout.write(output);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
