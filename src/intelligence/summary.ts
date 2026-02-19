/**
 * Session summary builder and Block Kit formatter.
 *
 * Aggregates audit log entries into a SessionSummary with decision counts and
 * notable events. Formats the summary as Slack Block Kit messages for end-of-session
 * visibility into what happened during the autonomous run.
 */
import type { KnownBlock } from '@slack/types';
import { readAuditLog } from './audit.js';

/** Aggregated statistics from a session's audit log. */
export interface SessionSummary {
  readonly totalEvents: number;
  readonly autoApproved: number;
  readonly escalated: number;
  readonly quietHoursSuppressed: number;
  readonly timedOut: number;
  readonly decisionsByType: Record<string, number>;
  readonly notableEvents: readonly string[];
}

/**
 * Builds a session summary by aggregating entries from the audit log.
 *
 * Counts decisions by type, groups events by eventType, and identifies
 * notable events (timed_out decisions and PostToolUseFailure events).
 * Returns a zero-count summary when the log is missing or empty.
 */
export function buildSessionSummary(logPath: string): SessionSummary {
  const entries = readAuditLog(logPath);

  let autoApproved = 0;
  let escalated = 0;
  let quietHoursSuppressed = 0;
  let timedOut = 0;
  const decisionsByType: Record<string, number> = {};
  const notableEvents: string[] = [];

  for (const entry of entries) {
    switch (entry.decision) {
      case 'auto_approved':
        autoApproved++;
        break;
      case 'escalated':
        escalated++;
        break;
      case 'quiet_hours_suppressed':
        quietHoursSuppressed++;
        break;
      case 'timed_out':
        timedOut++;
        break;
    }

    const currentCount = decisionsByType[entry.eventType] ?? 0;
    decisionsByType[entry.eventType] = currentCount + 1;

    if (entry.decision === 'timed_out') {
      notableEvents.push(
        `timed_out: ${entry.eventType} - ${entry.reason}`,
      );
    }

    if (entry.eventType === 'PostToolUseFailure') {
      const toolInfo = entry.toolName ? ` ${entry.toolName}` : '';
      notableEvents.push(
        `PostToolUseFailure:${toolInfo} - ${entry.reason}`,
      );
    }
  }

  return {
    totalEvents: entries.length,
    autoApproved,
    escalated,
    quietHoursSuppressed,
    timedOut,
    decisionsByType,
    notableEvents,
  };
}

/**
 * Produces Block Kit formatted message blocks from a SessionSummary.
 *
 * Returns: header, stats section, optional event-type breakdown,
 * optional notable events, or a "no events" message when empty.
 */
export function buildSummaryBlocks(summary: SessionSummary): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: 'header' as const,
    text: { type: 'plain_text' as const, text: 'Session Summary', emoji: true },
  });

  // Zero events shortcut
  if (summary.totalEvents === 0) {
    blocks.push({
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: 'No escalation events recorded',
      },
    });
    return blocks;
  }

  // Stats section
  const statsLines = [
    `*Total:* ${String(summary.totalEvents)}`,
    `*Auto-approved:* ${String(summary.autoApproved)}`,
    `*Escalated:* ${String(summary.escalated)}`,
    `*Suppressed:* ${String(summary.quietHoursSuppressed)}`,
    `*Timed out:* ${String(summary.timedOut)}`,
  ];

  blocks.push({
    type: 'section' as const,
    text: {
      type: 'mrkdwn' as const,
      text: statsLines.join('\n'),
    },
  });

  // Event type breakdown
  const typeEntries = Object.entries(summary.decisionsByType);
  if (typeEntries.length > 0) {
    const breakdownLines = typeEntries.map(
      ([eventType, count]) => `${eventType}: ${String(count)}`,
    );
    blocks.push({
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `*By Event Type:*\n${breakdownLines.join('\n')}`,
      },
    });
  }

  // Notable events
  if (summary.notableEvents.length > 0) {
    const notableLines = summary.notableEvents.map((e) => `- ${e}`);
    blocks.push({
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `*Notable Events:*\n${notableLines.join('\n')}`,
      },
    });
  }

  return blocks;
}
