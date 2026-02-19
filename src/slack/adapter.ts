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
import { buildEscalationBlocks, buildFallbackText } from './blocks.js';
import { registerActionHandler, registerMessageHandler } from './handlers.js';

/** Configuration options for the SlackAdapter. */
export interface SlackAdapterOptions {
  readonly botToken: string;
  readonly appToken: string;
  readonly channelId: string;
  readonly store: EscalationStore;
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

  /** Bidirectional mapping: escalation ID <-> Slack message timestamp. */
  private readonly escalationToTs = new Map<string, string>();
  private readonly tsToEscalation = new Map<string, string>();

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

    // Register Bolt event handlers with adapter callbacks
    const callbacks = {
      onAction: (escalationId: string, actionValue: string, userId: string): void => {
        this.handleAction(escalationId, actionValue, userId);
      },
      onThreadReply: (threadTs: string, text: string): void => {
        this.handleThreadReply(threadTs, text);
      },
    };

    registerActionHandler(this.app, callbacks);
    registerMessageHandler(this.app, callbacks);
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

    // Clean up maps
    const ts = this.escalationToTs.get(escalationId);
    if (ts) {
      this.tsToEscalation.delete(ts);
    }
    this.escalationToTs.delete(escalationId);
    this.responseResolvers.delete(escalationId);
  }

  /**
   * Handle a thread reply message from Slack.
   *
   * Looks up the escalation by thread timestamp, resolves it in the store,
   * calls the pending Promise resolver, and cleans up tracking maps.
   */
  private handleThreadReply(threadTs: string, text: string): void {
    const escalationId = this.tsToEscalation.get(threadTs);
    if (!escalationId) return; // Not a tracked thread

    const resolved = this.store.resolve(escalationId, JSON.stringify({ type: 'text', text }));

    if (!resolved) return; // Already resolved

    const resolver = this.responseResolvers.get(escalationId);
    if (resolver) {
      resolver({ type: 'text', text, respondedAt: new Date() });
    }

    // Clean up maps
    this.escalationToTs.delete(escalationId);
    this.tsToEscalation.delete(threadTs);
    this.responseResolvers.delete(escalationId);
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

    // Post startup announcement
    const postResult = await this.app.client.chat.postMessage({
      channel: this.channelId,
      text: ':zap: Escalate online -- ready to receive escalations',
    });
    if (!postResult.ok) {
      throw new Error(
        `Failed to post to channel ${this.channelId}. Check channel ID and bot permissions. Error: ${String(postResult.error)}`,
      );
    }
    console.error(`[escalate] Posted startup message to channel ${this.channelId}`);
  }

  /**
   * Send an escalation message to the Slack channel.
   *
   * Builds Block Kit blocks from the request, posts the message, and stores
   * the bidirectional mapping between escalation ID and message timestamp
   * for routing future responses.
   */
  async sendEscalation(request: EscalationRequest): Promise<string> {
    const escalationId = randomUUID();
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

    // Store bidirectional mapping
    this.escalationToTs.set(escalationId, ts);
    this.tsToEscalation.set(ts, escalationId);

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
