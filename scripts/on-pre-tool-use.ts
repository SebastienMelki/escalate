#!/usr/bin/env node
/**
 * PreToolUse hook — escalates dangerous tool invocations to Slack for human approval.
 *
 * Matched against Bash|Write|Edit tools via hooks.json matcher.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, pollForResponse, readTimeoutMs } from './lib/bridge-client.js';
import { buildPreToolUseOutput } from './lib/output-helpers.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;
  const port = readPort();
  const timeoutMs = readTimeoutMs('preToolUse');

  const esc = await createEscalation(port, {
    event_type: 'PreToolUse',
    request_json: JSON.stringify(input),
    fallback_action: 'deny',
    timeout_seconds: Math.ceil(timeoutMs / 1000),
  });

  const result = await pollForResponse(port, esc.escalation_id, timeoutMs);
  process.stdout.write(buildPreToolUseOutput(result));
  process.exit(0);
}

main().catch(() => process.exit(0));
