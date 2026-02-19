/**
 * Slack event handler registration.
 *
 * Wires Bolt App event listeners (action clicks and thread replies) to
 * adapter callbacks. Separated from the adapter class for testability
 * and single-responsibility.
 */
import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import { buildConfirmationBlocks } from './blocks.js';

/** Callback interface for the SlackAdapter to receive Bolt events. */
export interface SlackAdapterCallbacks {
  onAction(escalationId: string, actionValue: string, userId: string): void;
  onThreadReply(threadTs: string, text: string): void;
}

/**
 * Register an action handler for escalation button clicks.
 *
 * Listens for actions matching `escalate_*` pattern. Acknowledges immediately
 * (Slack 3-second requirement), parses the action ID, invokes the adapter
 * callback, and updates the original message with confirmation blocks.
 */
export function registerActionHandler(app: App, adapter: SlackAdapterCallbacks): void {
  app.action<BlockAction>(/^escalate_/, async ({ ack, action, body, client }) => {
    // CRITICAL: ack immediately -- Slack requires response within 3 seconds
    await ack();

    const buttonAction = action as ButtonAction;
    const actionId = buttonAction.action_id;
    const ts = body.message?.ts;
    const channelId = body.channel?.id;

    if (!ts || !channelId) return;

    // Parse action_id format: escalate_{escalationId}_{actionValue}
    const parts = actionId.split('_');
    // parts[0] = "escalate", parts[1] = escalationId, parts[2..] = actionValue
    if (parts.length < 3) return;
    const escalationId = parts[1];
    if (!escalationId) return;
    const actionValue = parts.slice(2).join('_');

    adapter.onAction(escalationId, actionValue, body.user.id);

    // Replace original message with confirmation blocks
    const confirmationBlocks = buildConfirmationBlocks(actionValue, body.user.id);
    const blocks = body.message?.['blocks'] as import('@slack/types').KnownBlock[] | undefined;
    const originalHeader = blocks?.[0];

    await client.chat.update({
      channel: channelId,
      ts,
      blocks: originalHeader ? [originalHeader, ...confirmationBlocks] : confirmationBlocks,
      text: `Action taken: ${actionValue}`,
    });
  });
}

/**
 * Register a message handler for thread replies to escalation messages.
 *
 * Listens for all messages, filters for thread replies only, ignores bot
 * messages (safety net alongside Bolt's ignoreSelf), and invokes the
 * adapter callback with the thread timestamp and message text.
 */
export function registerMessageHandler(app: App, adapter: SlackAdapterCallbacks): void {
  app.message(async ({ message }) => {
    // Only handle thread replies
    if (!('thread_ts' in message) || !message.thread_ts) return;

    // Ignore bot messages (safety net alongside Bolt's ignoreSelf)
    if ('bot_id' in message && message.bot_id) return;
    if ('subtype' in message && message.subtype === 'bot_message') return;

    const text = 'text' in message ? (message.text ?? '') : '';
    adapter.onThreadReply(message.thread_ts, text);

    await Promise.resolve(); // Bolt requires async handler signature
  });
}
