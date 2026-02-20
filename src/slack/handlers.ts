/**
 * Slack event handler registration.
 *
 * Wires Bolt App event listeners (action clicks and thread replies) to
 * adapter callbacks. Separated from the adapter class for testability
 * and single-responsibility.
 */
import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import { buildConfirmationBlocks, formatActionLabel } from './blocks.js';

/** Callback interface for the SlackAdapter to receive Bolt events. */
export interface SlackAdapterCallbacks {
  onAction(escalationId: string, actionValue: string, userId: string): void;
  onThreadReply(threadTs: string, text: string, userId: string): void;
  onReaction?(channelId: string, messageTs: string, emoji: string, userId: string): void;
  onFileShare?(
    threadTs: string,
    fileId: string,
    fileMimetype: string,
    fileSize: number,
    fileName: string,
    fileUrlPrivateDownload: string,
  ): void;
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

    // Replace original message: keep all context blocks, remove actions, append confirmation
    const blocks = body.message?.['blocks'] as import('@slack/types').KnownBlock[] | undefined;
    const blocksWithoutActions = (blocks ?? []).filter(
      (b: import('@slack/types').KnownBlock) => b.type !== 'actions',
    );
    const label = formatActionLabel(actionValue);
    const confirmationBlocks = buildConfirmationBlocks(label, body.user.id);

    await client.chat.update({
      channel: channelId,
      ts,
      blocks: [...blocksWithoutActions, ...confirmationBlocks],
      text: `Action taken: ${label}`,
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
    const userId = 'user' in message ? (message.user as string ?? '') : '';
    adapter.onThreadReply(message.thread_ts, text, userId);

    await Promise.resolve(); // Bolt requires async handler signature
  });
}

/**
 * Register a handler for emoji reactions on escalation messages.
 *
 * Listens for `reaction_added` events, filters for message-type items only,
 * and invokes the adapter callback with channel, message timestamp, emoji name,
 * and the reacting user ID.
 */
export function registerReactionHandler(app: App, adapter: SlackAdapterCallbacks): void {
  app.event('reaction_added', async ({ event }) => {
    // Bolt types the reaction_added event item as always having type 'message'
    // with channel and ts fields, so no guard needed.
    adapter.onReaction?.(event.item.channel, event.item.ts, event.reaction, event.user);

    await Promise.resolve(); // Bolt requires async handler signature
  });
}

/**
 * Register a handler for file shares (voice notes) in escalation threads.
 *
 * Listens for messages with file attachments in threads. Filters for audio
 * files only, ignores bot messages and non-thread messages, and invokes the
 * adapter callback for each audio file found.
 */
export function registerFileShareHandler(app: App, adapter: SlackAdapterCallbacks): void {
  app.message(async ({ message }) => {
    // Only handle thread replies
    if (!('thread_ts' in message) || !message.thread_ts) return;

    // Ignore bot messages
    if ('bot_id' in message && message.bot_id) return;
    if ('subtype' in message && message.subtype === 'bot_message') return;

    // Only handle messages with files
    const files = 'files' in message ? (message.files as Array<{
      id: string;
      mimetype?: string;
      size?: number;
      name?: string;
      url_private_download?: string;
    }> | undefined) : undefined;

    if (!files || files.length === 0) return;

    for (const file of files) {
      // Only process audio files (voice notes)
      if (!file.mimetype?.startsWith('audio/')) continue;

      // Must have a download URL
      if (!file.url_private_download) continue;

      adapter.onFileShare?.(
        message.thread_ts,
        file.id,
        file.mimetype,
        file.size ?? 0,
        file.name ?? 'voice_note.webm',
        file.url_private_download,
      );
    }

    await Promise.resolve(); // Bolt requires async handler signature
  });
}
