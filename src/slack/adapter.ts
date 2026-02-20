/**
 * Slack messaging adapter.
 *
 * Implements the MessagingAdapter interface using @slack/bolt Socket Mode.
 * Manages the lifecycle of a Bolt App, routes button clicks and thread
 * replies to the EscalationStore, and provides the waitForResponse Promise
 * pattern for the escalation engine.
 *
 * CRITICAL: Uses LogLevel.ERROR to prevent stdout pollution of MCP stdio.
 */
import { randomUUID } from 'node:crypto';
import { App, LogLevel } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { MessagingAdapter } from '../types/adapter.js';
import type { EscalationRequest, UserResponse } from '../types/escalation.js';
import type { EscalationStore } from '../state/store.js';
import type { TranscriptionProvider } from '../transcription/index.js';
import type { EscalateConfig } from '../config/schema.js';
import {
  buildEscalationBlocks,
  buildFallbackText,
  buildStartupBlocks,
  buildDismissedBlocks,
  buildConfirmationBlocks,
  formatActionLabel,
} from './blocks.js';
import {
  registerActionHandler,
  registerMessageHandler,
  registerReactionHandler,
  registerFileShareHandler,
} from './handlers.js';

/** Configuration options for the SlackAdapter. */
export interface SlackAdapterOptions {
  readonly botToken: string;
  readonly appToken: string;
  readonly channelId: string;
  readonly store: EscalationStore;
  readonly config: EscalateConfig;
  readonly transcriptionProvider?: TranscriptionProvider | undefined;
}

/**
 * SlackAdapter connects the escalation system to Slack via Socket Mode.
 *
 * Sends escalation messages as rich Block Kit layouts, receives button
 * clicks and thread replies, and resolves pending escalations in the
 * SQLite-backed EscalationStore.
 */
export class SlackAdapter implements MessagingAdapter {
  private readonly app: App;
  private readonly channelId: string;
  private readonly store: EscalationStore;
  private readonly config: EscalateConfig;
  private readonly transcriptionProvider: TranscriptionProvider | undefined;
  private readonly botToken: string;

  /** Emoji name-to-action mapping built from config. */
  private readonly emojiMapping: Map<string, string>;

  /** Bidirectional mapping: escalation ID <-> Slack message timestamp. */
  private readonly escalationToTs = new Map<string, string>();
  private readonly tsToEscalation = new Map<string, string>();

  /** Original Block Kit blocks keyed by escalation ID (for dismiss updates). */
  private readonly escalationBlocks = new Map<string, import('@slack/types').KnownBlock[]>();

  /** Pending Promise resolvers keyed by escalation ID. */
  private readonly responseResolvers = new Map<string, (response: UserResponse) => void>();

  private connected = false;

  constructor(options: SlackAdapterOptions) {
    this.app = new App({
      socketMode: true,
      appToken: options.appToken,
      token: options.botToken,
      logLevel: LogLevel.ERROR, // CRITICAL: prevent stdout pollution of MCP stdio
    });

    this.channelId = options.channelId;
    this.store = options.store;
    this.config = options.config;
    this.transcriptionProvider = options.transcriptionProvider;
    this.botToken = options.botToken;

    // Build emoji mapping from config
    this.emojiMapping = new Map<string, string>(
      Object.entries(this.config.multimodal.emojiReactions.mapping),
    );

    // Register Bolt event handlers with adapter callbacks
    const callbacks = {
      onAction: (escalationId: string, actionValue: string, userId: string): void => {
        this.handleAction(escalationId, actionValue, userId);
      },
      onThreadReply: (threadTs: string, text: string, userId: string): void => {
        this.handleThreadReply(threadTs, text, userId);
      },
      onReaction: (channelId: string, messageTs: string, emoji: string, userId: string): void => {
        this.handleReaction(channelId, messageTs, emoji, userId);
      },
      onFileShare: (
        threadTs: string,
        fileId: string,
        mimeType: string,
        fileSize: number,
        fileName: string,
        downloadUrl: string,
      ): void => {
        this.handleFileShare(threadTs, fileId, mimeType, fileSize, fileName, downloadUrl);
      },
    };

    registerActionHandler(this.app, callbacks);
    registerMessageHandler(this.app, callbacks);

    // Conditionally register multimodal handlers
    if (this.config.multimodal.emojiReactions.enabled) {
      registerReactionHandler(this.app, callbacks);
    }
    if (this.config.multimodal.voiceNotes.enabled) {
      registerFileShareHandler(this.app, callbacks);
    }
  }

  /**
   * Handle a button click action from Slack.
   *
   * Resolves the escalation in the store, calls the pending Promise
   * resolver if one exists, and cleans up tracking maps.
   */
  private handleAction(escalationId: string, actionValue: string, _userId: string): void {
    const resolved = this.store.resolve(
      escalationId,
      JSON.stringify({ type: 'action', actionId: actionValue }),
    );

    if (!resolved) return; // Already resolved (race with thread reply)

    const resolver = this.responseResolvers.get(escalationId);
    if (resolver) {
      resolver({ type: 'action', actionId: actionValue, respondedAt: new Date() });
    }

    // Clean up heavy maps (keep escalationToTs/tsToEscalation for PostToolUse follow-ups)
    this.escalationBlocks.delete(escalationId);
    this.responseResolvers.delete(escalationId);
  }

  /**
   * Fire-and-forget Slack message update: strip action buttons and append
   * confirmation blocks so resolved escalations no longer show clickable buttons.
   */
  private updateResolvedMessage(
    ts: string,
    originalBlocks: KnownBlock[],
    confirmationBlocks: KnownBlock[],
    fallbackText: string,
  ): void {
    const blocksWithoutActions = originalBlocks.filter((b) => b.type !== 'actions');
    void this.app.client.chat.update({
      channel: this.channelId,
      ts,
      blocks: [...blocksWithoutActions, ...confirmationBlocks],
      text: fallbackText,
    }).catch((err: unknown) => {
      console.error('[escalate] Failed to update resolved message:', err);
    });
  }

  /**
   * Handle a thread reply message from Slack.
   *
   * Looks up the escalation by thread timestamp, resolves it in the store,
   * calls the pending Promise resolver, and cleans up tracking maps.
   */
  private handleThreadReply(threadTs: string, text: string, userId: string): void {
    const escalationId = this.tsToEscalation.get(threadTs);
    if (!escalationId) return; // Not a tracked thread

    // Capture message metadata BEFORE cleanup
    const originalBlocks = this.escalationBlocks.get(escalationId) ?? [];

    const resolved = this.store.resolve(escalationId, JSON.stringify({ type: 'text', text }));

    if (!resolved) return; // Already resolved

    const resolver = this.responseResolvers.get(escalationId);
    if (resolver) {
      resolver({ type: 'text', text, respondedAt: new Date() });
    }

    // Update Slack message to remove action buttons
    const confirmation = buildConfirmationBlocks(
      'Replied in thread',
      userId,
    );
    this.updateResolvedMessage(threadTs, originalBlocks, confirmation, 'Replied in thread');

    // Clean up heavy maps (keep escalationToTs/tsToEscalation for PostToolUse follow-ups)
    this.escalationBlocks.delete(escalationId);
    this.responseResolvers.delete(escalationId);
  }

  /**
   * Handle an emoji reaction on a Slack message.
   *
   * Looks up the escalation by message timestamp, checks the emoji mapping,
   * resolves via store.resolve(), and calls the pending Promise resolver.
   * Unrecognized emoji or reactions on non-escalation messages are silently ignored.
   */
  private handleReaction(
    channelId: string,
    messageTs: string,
    emoji: string,
    userId: string,
  ): void {
    // Only handle reactions in our channel
    if (channelId !== this.channelId) return;

    // Look up escalation by message timestamp
    const escalationId = this.tsToEscalation.get(messageTs);
    if (!escalationId) return; // Not a tracked escalation message

    // Look up action from emoji mapping
    const decision = this.emojiMapping.get(emoji);
    if (!decision) return; // Unrecognized emoji, silently ignore

    // Capture message metadata BEFORE cleanup
    const ts = this.escalationToTs.get(escalationId);
    const originalBlocks = this.escalationBlocks.get(escalationId) ?? [];

    // Resolve in store (idempotent, returns false if already resolved)
    const resolved = this.store.resolve(
      escalationId,
      JSON.stringify({ type: 'reaction', emoji, actionId: decision }),
    );
    if (!resolved) return; // Already resolved

    // Call pending Promise resolver
    const resolver = this.responseResolvers.get(escalationId);
    if (resolver) {
      resolver({ type: 'reaction', emoji, actionId: decision, respondedAt: new Date() });
    }

    // Update Slack message to remove action buttons
    const label = formatActionLabel(decision);
    const confirmation = buildConfirmationBlocks(label, userId);
    if (ts) {
      this.updateResolvedMessage(ts, originalBlocks, confirmation, `Action taken: ${label}`);
    }

    // Clean up heavy maps (keep escalationToTs/tsToEscalation for PostToolUse follow-ups)
    this.escalationBlocks.delete(escalationId);
    this.responseResolvers.delete(escalationId);
  }

  /**
   * Handle a file share in an escalation thread (synchronous dispatcher).
   *
   * Guards on escalation tracking, transcription provider availability, and
   * file size limits. Fires and forgets the async voice note processing pipeline.
   */
  private handleFileShare(
    threadTs: string,
    _fileId: string,
    mimeType: string,
    fileSize: number,
    fileName: string,
    downloadUrl: string,
  ): void {
    // Look up escalation by thread timestamp
    const escalationId = this.tsToEscalation.get(threadTs);
    if (!escalationId) return; // Not a tracked escalation thread

    // Voice notes not configured
    if (!this.transcriptionProvider) return;

    // File too large
    if (fileSize > this.config.multimodal.voiceNotes.maxFileSizeMb * 1024 * 1024) return;

    // Fire and forget the async processing pipeline
    void this.processVoiceNote(
      escalationId,
      threadTs,
      mimeType,
      fileName,
      downloadUrl,
    ).catch((err: unknown) => {
      console.error('[escalate] Voice note processing failed:', err);
    });
  }

  /**
   * Process a voice note: download, transcribe, and resolve the escalation.
   *
   * On transcription failure, posts a fallback thread reply asking the user
   * to type instead, leaving the escalation pending.
   */
  private async processVoiceNote(
    escalationId: string,
    threadTs: string,
    mimeType: string,
    fileName: string,
    downloadUrl: string,
  ): Promise<void> {
    try {
      // Download audio from Slack
      const audioBuffer = await this.downloadFile(downloadUrl);

      // Transcribe using configured provider (guard checked in handleFileShare)
      if (!this.transcriptionProvider) return;
      const result = await this.transcriptionProvider.transcribe(audioBuffer, mimeType, fileName);

      if (!result.text) {
        throw new Error('Transcription returned empty text');
      }

      // Capture message metadata BEFORE cleanup
      const ts = this.escalationToTs.get(escalationId);
      const originalBlocks = this.escalationBlocks.get(escalationId) ?? [];

      // Resolve in store
      const resolved = this.store.resolve(
        escalationId,
        JSON.stringify({ type: 'voice', text: result.text }),
      );
      if (!resolved) return; // Already resolved by another handler

      // Call pending Promise resolver (use 'text' type for downstream compatibility)
      const resolver = this.responseResolvers.get(escalationId);
      if (resolver) {
        resolver({ type: 'text', text: result.text, respondedAt: new Date() });
      }

      // Update Slack message to remove action buttons
      const confirmation = buildConfirmationBlocks('Voice note', '');
      if (ts) {
        this.updateResolvedMessage(ts, originalBlocks, confirmation, 'Voice note');
      }

      // Clean up heavy maps (keep escalationToTs/tsToEscalation for PostToolUse follow-ups)
      this.escalationBlocks.delete(escalationId);
      this.responseResolvers.delete(escalationId);
    } catch (err: unknown) {
      console.error('[escalate] Transcription failed:', err);

      // Post fallback thread reply -- do NOT resolve the escalation
      await this.app.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: threadTs,
        text: ':warning: Could not transcribe voice note. Please type your response instead.',
      });
    }
  }

  /**
   * Download a file from Slack using the bot token for authentication.
   */
  private async downloadFile(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + this.botToken },
    });
    if (!response.ok) {
      throw new Error('Slack file download failed: ' + String(response.status));
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** Start the Bolt App Socket Mode WebSocket connection. */
  async start(): Promise<void> {
    await this.app.start();
    this.connected = true;
    console.error('[escalate] Slack Socket Mode connected');
  }

  /** Stop the Bolt App and disconnect. */
  async stop(): Promise<void> {
    await this.app.stop();
    this.connected = false;
  }

  /**
   * Validate Slack credentials and post a startup announcement.
   *
   * Calls auth.test to verify the bot token, then posts a message to the
   * configured channel to confirm the bot is online. Throws on failure
   * with actionable error messages (CFG-03).
   */
  async validateAndAnnounce(): Promise<void> {
    // Verify bot token
    const result = await this.app.client.auth.test();
    if (!result.ok) {
      throw new Error(
        `Slack authentication failed. Check ESCALATE_SLACK_BOT_TOKEN. Error: ${String(result.error)}`,
      );
    }
    console.error(
      `[escalate] Authenticated as ${String(result.user)} in workspace ${String(result.team)}`,
    );

    // Post startup announcement with Block Kit
    const postResult = await this.app.client.chat.postMessage({
      channel: this.channelId,
      blocks: buildStartupBlocks(),
      text: 'Escalate is online and monitoring this channel',
    });
    if (!postResult.ok) {
      throw new Error(
        `Failed to post to channel ${this.channelId}. Check channel ID and bot permissions. Error: ${String(postResult.error)}`,
      );
    }
    console.error(`[escalate] Posted startup message to channel ${this.channelId}`);

    // Voice note prerequisite validation (warn but do not throw -- graceful degradation)
    if (this.config.multimodal.voiceNotes.enabled) {
      const apiKey =
        process.env['ESCALATE_OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        console.error(
          '[escalate] WARNING: Voice notes enabled but ESCALATE_OPENAI_API_KEY not set. Voice note transcription will fail.',
        );
      }
      if (!this.transcriptionProvider) {
        console.error(
          '[escalate] WARNING: Voice notes enabled but no transcription provider configured.',
        );
      }
    }
  }

  /**
   * Send an escalation message to the Slack channel.
   *
   * Builds Block Kit blocks from the request, posts the message, and stores
   * the bidirectional mapping between escalation ID and message timestamp
   * for routing future responses.
   */
  async sendEscalation(request: EscalationRequest): Promise<string> {
    const escalationId = request.id ?? randomUUID();
    const blocks = buildEscalationBlocks(request, escalationId);
    const text = buildFallbackText(request);

    const result = await this.app.client.chat.postMessage({
      channel: this.channelId,
      blocks,
      text,
    });

    const ts = result.ts;
    if (!ts) {
      throw new Error('Slack chat.postMessage did not return a message timestamp');
    }

    // Store bidirectional mapping and original blocks for dismiss updates
    this.escalationToTs.set(escalationId, ts);
    this.tsToEscalation.set(ts, escalationId);
    this.escalationBlocks.set(escalationId, blocks);

    return escalationId;
  }

  /**
   * Wait for a user response to an escalation.
   *
   * Returns a Promise that resolves when the user clicks a button or
   * replies in the thread, or when the timeout expires. The resolver
   * is stored in the responseResolvers map and called by handleAction
   * or handleThreadReply.
   */
  async waitForResponse(escalationId: string, timeoutMs: number): Promise<UserResponse> {
    return new Promise<UserResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.responseResolvers.delete(escalationId);
        resolve({ type: 'timeout', respondedAt: new Date() });
      }, timeoutMs);

      this.responseResolvers.set(escalationId, (response: UserResponse) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  /**
   * Send a follow-up message to an existing escalation thread.
   *
   * Posts a threaded reply using the stored message timestamp. Silently
   * ignores unknown escalation IDs (already resolved or not tracked).
   */
  async sendFollowUp(escalationId: string, message: string): Promise<void> {
    const ts = this.escalationToTs.get(escalationId);
    if (!ts) return; // Not tracked or already cleaned up

    await this.app.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: ts,
      text: message,
    });
  }

  /**
   * Update a Slack escalation message when resolved outside of Slack.
   *
   * Replaces the action buttons with a status indicator (e.g. "Resolved from CLI",
   * "Timed out") while preserving the original message context (header, tool info,
   * question). Cleans up all tracking maps for this escalation.
   */
  async dismissEscalation(escalationId: string, source: string): Promise<void> {
    const ts = this.escalationToTs.get(escalationId);
    if (!ts) return; // Not tracked or already cleaned up

    // Get original blocks and remove the actions row
    const originalBlocks = this.escalationBlocks.get(escalationId) ?? [];
    const blocksWithoutActions = originalBlocks.filter((b) => b.type !== 'actions');

    // Append resolution indicator
    const dismissSource = source === 'timeout' ? 'timeout' : source === 'auto_approved' ? 'auto_approved' : 'cli';
    const dismissBlocks = buildDismissedBlocks(dismissSource);

    await this.app.client.chat.update({
      channel: this.channelId,
      ts,
      blocks: [...blocksWithoutActions, ...dismissBlocks],
      text: dismissSource === 'cli' ? 'Resolved from CLI' : dismissSource === 'timeout' ? 'Timed out' : 'Auto-approved',
    });

    // Clean up heavy maps (keep escalationToTs/tsToEscalation for PostToolUse follow-ups)
    this.escalationBlocks.delete(escalationId);
    this.responseResolvers.delete(escalationId);
  }

  /**
   * Send a session summary as a top-level channel message.
   *
   * This is NOT part of the MessagingAdapter interface -- it is Slack-specific.
   * Posts Block Kit blocks directly to the configured channel (not a threaded reply).
   */
  async sendSummary(blocks: KnownBlock[]): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: this.channelId,
      blocks,
      text: 'Session Summary', // fallback for notifications
    });
  }

  /** Check if the adapter is currently connected to Slack. */
  isConnected(): boolean {
    return this.connected;
  }
}
