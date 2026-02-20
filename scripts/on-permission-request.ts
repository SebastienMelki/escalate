#!/usr/bin/env node
/**
 * PermissionRequest hook — escalates permission requests to Slack for human approval.
 *
 * Reads stdin JSON, creates escalation, polls for response, outputs allow/deny decision.
 * Auto-approves the escalate plugin's own MCP tools to prevent recursive escalation.
 * When the process is killed (user approved from CLI), dismisses the Slack message.
 * CRITICAL: No console.log() — stdout is owned by Claude Code for JSON output.
 */
import { readFileSync } from 'node:fs';
import { readPort, createEscalation, pollForResponse, dismissEscalation, readTimeoutMs, writeLastEscalationId } from './lib/bridge-client.js';
import { buildPermissionRequestOutput, buildAskUserQuestionOutput } from './lib/output-helpers.js';
import { isEscalateInternalTool, isCoveredByPreToolUse, AUTO_APPROVE_OUTPUT } from './lib/self-bypass.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;

  const toolName = input['tool_name'];
  if (typeof toolName === 'string') {
    // Auto-approve the escalate plugin's own tools to prevent recursive escalation
    if (isEscalateInternalTool(toolName)) {
      process.stdout.write(AUTO_APPROVE_OUTPUT.permissionRequest);
      process.exit(0);
    }
    // Skip tools already covered by the PreToolUse hook to avoid double escalation
    if (isCoveredByPreToolUse(toolName)) {
      process.stdout.write(AUTO_APPROVE_OUTPUT.permissionRequest);
      process.exit(0);
    }
  }

  const port = readPort();
  const timeoutMs = readTimeoutMs('permissionRequest');

  const esc = await createEscalation(port, {
    event_type: 'PermissionRequest',
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

  if (typeof toolName === 'string' && toolName === 'AskUserQuestion') {
    const toolInput = (input['tool_input'] ?? {}) as Record<string, unknown>;
    process.stdout.write(buildAskUserQuestionOutput(result, toolInput));
  } else {
    process.stdout.write(buildPermissionRequestOutput(result));
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
