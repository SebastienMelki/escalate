/**
 * MessagingAdapter interface.
 *
 * The contract between the escalation engine and platform-specific adapters.
 * All messaging platforms (Slack, Discord, etc.) implement this interface.
 * Types are platform-agnostic -- no Slack Block Kit, thread_ts, or channel IDs.
 */
import type { EscalationRequest, UserResponse } from './escalation.js';

export interface MessagingAdapter {
  /** Send an escalation message. Returns a unique escalation ID for tracking. */
  sendEscalation(request: EscalationRequest): Promise<string>;

  /** Wait for a user response to a specific escalation. Returns the response or times out. */
  waitForResponse(escalationId: string, timeoutMs: number): Promise<UserResponse>;

  /** Send a follow-up message to an existing escalation thread. */
  sendFollowUp(escalationId: string, message: string): Promise<void>;

  /** Check if the adapter is currently connected to the messaging platform. */
  isConnected(): boolean;
}
