#!/usr/bin/env node
/**
 * TaskCompleted hook -- sends a session summary when a task finishes.
 *
 * Thin dispatcher: reads stdin, discovers bridge port, fires summary request.
 * CRITICAL: No console.log() -- stdout is owned by Claude Code for JSON output.
 */
import { readPort, requestSummary } from './lib/bridge-client.js';

async function main(): Promise<void> {
  // Read stdin (TaskCompleted event has task_id, task_subject, task_description)
  // We don't use these fields -- just trigger the summary.
  const port = readPort();
  await requestSummary(port).catch(() => {});
  process.exit(0);
}

main().catch(() => process.exit(0));
