/**
 * Block Kit message builder.
 *
 * Pure functions that convert platform-agnostic EscalationRequest objects into
 * Slack Block Kit JSON arrays. Stateless and easily testable without a Slack
 * connection.
 */
import type { KnownBlock, Button, MrkdwnElement } from '@slack/types';
import type { EscalationRequest, SuggestedAction } from '../types/escalation.js';

/**
 * Converts an EscalationRequest into a Block Kit block array for Slack.
 *
 * Produces: header, context (event metadata), divider, question section,
 * optional task-context section, optional file-paths context, optional
 * action buttons.
 */
export function buildEscalationBlocks(
  request: EscalationRequest,
  escalationId: string,
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header: title
  blocks.push({
    type: 'header' as const,
    text: { type: 'plain_text' as const, text: request.title, emoji: true },
  });

  // Context: event metadata (event type always, tool name if present)
  const contextElements: MrkdwnElement[] = [
    { type: 'mrkdwn' as const, text: `*Event:* ${request.context.eventType}` },
  ];

  if (request.context.toolName) {
    contextElements.push({
      type: 'mrkdwn' as const,
      text: `*Tool:* \`${request.context.toolName}\``,
    });
  }

  blocks.push({
    type: 'context' as const,
    elements: contextElements,
  });

  // Divider
  blocks.push({ type: 'divider' as const });

  // Question section
  blocks.push({
    type: 'section' as const,
    text: { type: 'mrkdwn' as const, text: request.question },
  });

  // Task context (conditional)
  if (request.context.taskContext) {
    blocks.push({
      type: 'section' as const,
      text: { type: 'mrkdwn' as const, text: `> ${request.context.taskContext}` },
    });
  }

  // File paths (conditional)
  if (request.context.filePaths && request.context.filePaths.length > 0) {
    blocks.push({
      type: 'context' as const,
      elements: [
        {
          type: 'mrkdwn' as const,
          text: `*Files:* ${request.context.filePaths.join(', ')}`,
        },
      ],
    });
  }

  // Action buttons (conditional)
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

/**
 * Builds replacement blocks shown after a button click.
 *
 * Replaces the original escalation message content with a confirmation
 * indicating which action was taken and by whom.
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

/**
 * Builds a plain-text fallback string for non-Block-Kit clients.
 *
 * Used as the `text` field in chat.postMessage alongside blocks for
 * notification preview and accessibility.
 */
export function buildFallbackText(request: EscalationRequest): string {
  return `${request.title}: ${request.question}`;
}
