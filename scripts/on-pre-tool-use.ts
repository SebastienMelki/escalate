#!/usr/bin/env node
/**
 * PreToolUse hook — escalates dangerous tool invocations to Slack for human approval.
 *
 * Matched against Bash|Write|Edit tools via hooks.json matcher.
 * Auto-approves the escalate plugin's own MCP tools to prevent recursive escalation.
 * When the process is killed (user approved from CLI), dismisses the Slack message.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, pollForResponse, dismissEscalation, readTimeoutMs, writeLastEscalationId } from './lib/bridge-client.js';
import { buildPreToolUseOutput } from './lib/output-helpers.js';
import { isEscalateInternalTool, AUTO_APPROVE_OUTPUT } from './lib/self-bypass.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;

  // Auto-approve the escalate plugin's own tools to prevent recursive escalation
  const toolName = input['tool_name'];
  if (typeof toolName === 'string' && isEscalateInternalTool(toolName)) {
    process.stdout.write(AUTO_APPROVE_OUTPUT.preToolUse);
    process.exit(0);
  }

  const port = readPort();
  const timeoutMs = readTimeoutMs('preToolUse');

  const esc = await createEscalation(port, {
    event_type: 'PreToolUse',
    request_json: JSON.stringify(input),
    fallback_action: 'deny',
    timeout_seconds: Math.ceil(timeoutMs / 1000),
  });

  // Register cleanup: if process is killed (user approved from CLI), update Slack message
  const cleanup = (): void => {
    dismissEscalation(port, esc.escalation_id, 'cli')
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  const result = await pollForResponse(port, esc.escalation_id, timeoutMs);

  // If timed out, update Slack message; otherwise write ID for PostToolUse follow-up
  if (result.status === 'timed_out') {
    await dismissEscalation(port, esc.escalation_id, 'timeout').catch(() => {});
  } else {
    writeLastEscalationId(esc.escalation_id);
  }

  // Remove signal handlers (resolved normally, no need for cleanup)
  process.removeListener('SIGTERM', cleanup);
  process.removeListener('SIGINT', cleanup);

  process.stdout.write(buildPreToolUseOutput(result));
  process.exit(0);
}

main().catch(() => process.exit(0));
