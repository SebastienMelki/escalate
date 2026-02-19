#!/usr/bin/env node
/**
 * PostToolUseFailure hook — fire-and-forget notification to Slack about tool failures.
 *
 * Creates escalation but does NOT poll for response. Exits 0 immediately.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, readTimeoutMs } from './lib/bridge-client.js';
import { buildPostToolFailureOutput } from './lib/output-helpers.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;
  const port = readPort();
  const timeoutMs = readTimeoutMs('postToolUseFailure');

  await createEscalation(port, {
    event_type: 'PostToolUseFailure',
    request_json: JSON.stringify(input),
    fallback_action: 'allow',
    timeout_seconds: Math.ceil(timeoutMs / 1000),
  });

  // Fire-and-forget notification. Provide context back to Claude.
  process.stdout.write(buildPostToolFailureOutput());
  process.exit(0);
}

main().catch(() => process.exit(0));
