/**
 * Slack-specific internal types.
 *
 * These types are internal to the Slack adapter and are NOT part of the
 * platform-agnostic escalation interface. They map escalation concepts to
 * Slack-specific identifiers (message timestamps, channel IDs).
 */

/** Maps an escalation to its Slack message coordinates. */
export interface EscalationMessage {
  readonly escalationId: string;
  readonly channelId: string;
  readonly ts: string;
  readonly threadTs?: string | undefined;
}

/** Maps SuggestedAction.style to Slack button styles. */
export type ButtonStyle = 'primary' | 'danger' | undefined;

/** Ephemeral adapter state (not persisted to SQLite). */
export interface SlackAdapterState {
  readonly connected: boolean;
  readonly escalationToTs: Map<string, string>;
  readonly tsToEscalation: Map<string, string>;
}
