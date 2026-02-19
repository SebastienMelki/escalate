#!/usr/bin/env node
/**
 * Stop hook — escalates stop events to Slack so user can continue or allow stop.
 *
 * Checks stop_hook_active to prevent infinite loops (re-stop after block).
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, pollForResponse, requestSummary } from './lib/bridge-client.js';
import { buildStopOutput } from './lib/output-helpers.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;

  // Prevent infinite loop: if stop_hook_active, this is a re-stop. Allow it.
  if (input['stop_hook_active']) {
    process.exit(0);
  }

  const port = readPort();

  const esc = await createEscalation(port, {
    event_type: 'Stop',
    request_json: JSON.stringify(input),
    fallback_action: 'allow',
    timeout_seconds: 600,
  });

  const result = await pollForResponse(port, esc.escalation_id);
  const output = buildStopOutput(result);
  if (output) {
    process.stdout.write(output);
  }

  // Fire-and-forget session summary after escalation resolution
  void requestSummary(port).catch(() => {});

  process.exit(0);
}

main().catch(() => process.exit(0));
