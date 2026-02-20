/**
 * Block Kit message builder.
 *
 * Pure functions that convert platform-agnostic EscalationRequest objects into
 * Slack Block Kit JSON arrays. Stateless and easily testable without a Slack
 * connection.
 */
import type { KnownBlock, Button, MrkdwnElement } from '@slack/types';
import type { EscalationRequest, SuggestedAction, UrgencyLevel } from '../types/escalation.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Urgency → emoji for header display. */
const URGENCY_EMOJI: Record<UrgencyLevel, string> = {
  critical: ':rotating_light:',
  warning: ':warning:',
  info: ':large_blue_circle:',
};

/**
 * Clean up MCP-prefixed tool names for human-readable display.
 *
 * `mcp__plugin_escalate_escalate__create_escalation` → `escalate > create_escalation`
 * `Bash` → `Bash`
 */
function cleanToolName(rawName: string): string {
  if (rawName.startsWith('mcp__')) {
    const withoutPrefix = rawName.slice(5);
    const idx = withoutPrefix.indexOf('__');
    if (idx > 0) {
      const server = withoutPrefix.slice(0, idx);
      const tool = withoutPrefix.slice(idx + 2);
      return `${server} > ${tool}`;
    }
    return withoutPrefix;
  }
  return rawName;
}

/* ------------------------------------------------------------------ */
/*  Escalation message                                                */
/* ------------------------------------------------------------------ */

/**
 * Converts an EscalationRequest into a rich Block Kit block array.
 *
 * Layout:
 *   1. Header — urgency emoji + descriptive title
 *   2. Section fields — tool name, urgency badge
 *   3. Divider
 *   4. Section — formatted question / command
 *   5. Context — file paths (optional)
 *   6. Section — task context (optional)
 *   7. Actions — approve / deny / snooze buttons
 */
export function buildEscalationBlocks(
  request: EscalationRequest,
  escalationId: string,
): KnownBlock[] {
  const blocks: KnownBlock[] = [];
  const emoji = URGENCY_EMOJI[request.urgency] ?? ':grey_question:';
  const toolDisplay = request.context.toolName
    ? cleanToolName(request.context.toolName)
    : undefined;

  // 1. Header with urgency indicator
  blocks.push({
    type: 'header' as const,
    text: {
      type: 'plain_text' as const,
      text: `${emoji} ${request.title}`,
      emoji: true,
    },
  });

  // 2. Metadata fields (tool + urgency in a 2-column layout)
  const fields: MrkdwnElement[] = [];
  if (toolDisplay) {
    fields.push({
      type: 'mrkdwn' as const,
      text: `*Tool*\n\`${toolDisplay}\``,
    });
  }
  fields.push({
    type: 'mrkdwn' as const,
    text: `*Urgency*\n${request.urgency.charAt(0).toUpperCase() + request.urgency.slice(1)}`,
  });

  if (fields.length > 0) {
    blocks.push({
      type: 'section' as const,
      fields,
    });
  }

  // 3. Divider
  blocks.push({ type: 'divider' as const });

  // 4. Question / details section
  blocks.push({
    type: 'section' as const,
    text: { type: 'mrkdwn' as const, text: request.question },
  });

  // 5. File paths (conditional)
  if (request.context.filePaths && request.context.filePaths.length > 0) {
    const pathText = request.context.filePaths.map((p) => `\`${p}\``).join('  ');
    blocks.push({
      type: 'context' as const,
      elements: [
        { type: 'mrkdwn' as const, text: `:file_folder: ${pathText}` },
      ],
    });
  }

  // 6. Task context (conditional)
  if (request.context.taskContext) {
    blocks.push({
      type: 'section' as const,
      text: { type: 'mrkdwn' as const, text: `> ${request.context.taskContext}` },
    });
  }

  // 7. Action buttons
  if (request.suggestedActions.length > 0) {
    blocks.push({
      type: 'actions' as const,
      elements: request.suggestedActions.map(
        (action: SuggestedAction): Button => ({
          type: 'button' as const,
          text: { type: 'plain_text' as const, text: action.label, emoji: true },
          action_id: `escalate_${escalationId}_${action.id}`,
          value: action.id,
          ...(action.style === 'primary' ? { style: 'primary' as const } : {}),
          ...(action.style === 'danger' ? { style: 'danger' as const } : {}),
        }),
      ),
    });
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/*  Confirmation (button click in Slack)                              */
/* ------------------------------------------------------------------ */

/**
 * Builds replacement blocks shown after a Slack button click.
 *
 * Replaces the action buttons with a confirmation indicator while
 * keeping the original header for context.
 */
export function buildConfirmationBlocks(actionLabel: string, userId: string): KnownBlock[] {
  return [
    {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `:white_check_mark: *${actionLabel}* by <@${userId}>`,
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Dismissed (resolved from CLI or timed out)                        */
/* ------------------------------------------------------------------ */

/**
 * Builds a resolution indicator for escalations resolved outside Slack.
 *
 * Used to replace action buttons when the dev approves from the CLI
 * or the escalation times out.
 */
export function buildDismissedBlocks(
  source: 'cli' | 'timeout' | 'auto_approved',
): KnownBlock[] {
  const config: Record<string, { emoji: string; label: string }> = {
    cli: { emoji: ':desktop_computer:', label: 'Resolved from CLI' },
    timeout: { emoji: ':hourglass:', label: 'Timed out' },
    auto_approved: { emoji: ':white_check_mark:', label: 'Auto-approved' },
  };
  const { emoji, label } = config[source] ?? config['cli']!;

  return [
    {
      type: 'section' as const,
      text: { type: 'mrkdwn' as const, text: `${emoji} *${label}*` },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Action label formatting                                           */
/* ------------------------------------------------------------------ */

const ACTION_PAST_TENSE: Record<string, string> = {
  approve: 'Approved',
  deny: 'Denied',
  snooze: 'Snoozed',
  continue: 'Continued',
  stop: 'Stopped',
  acknowledge: 'Acknowledged',
};

/**
 * Convert an action ID to a human-readable past-tense label.
 *
 * Known actions get a curated past-tense form; unknown actions are
 * title-cased (first letter uppercase).
 */
export function formatActionLabel(actionId: string): string {
  return ACTION_PAST_TENSE[actionId] ?? actionId.charAt(0).toUpperCase() + actionId.slice(1);
}

/* ------------------------------------------------------------------ */
/*  Startup announcement                                              */
/* ------------------------------------------------------------------ */

/**
 * Builds a compact startup announcement using Block Kit.
 */
export function buildStartupBlocks(): KnownBlock[] {
  return [
    {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: ':zap: *Escalate* is online and monitoring this channel',
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Fallback text                                                     */
/* ------------------------------------------------------------------ */

/**
 * Builds a plain-text fallback string for non-Block-Kit clients.
 *
 * Used as the `text` field in chat.postMessage alongside blocks for
 * notification preview and accessibility.
 */
export function buildFallbackText(request: EscalationRequest): string {
  return `${request.title}: ${request.question}`;
}
