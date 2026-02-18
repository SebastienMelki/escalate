/**
 * Core escalation data types.
 *
 * These types define the shape of escalation requests, responses, and related
 * concepts. They are platform-agnostic -- no Slack-specific types here.
 */

/** Urgency level affects display formatting and quiet hours filtering. */
export type UrgencyLevel = 'info' | 'warning' | 'critical';

/** How the user responded to an escalation. */
export type ResponseType = 'action' | 'text' | 'timeout';

/** A suggested action button presented to the user. */
export interface SuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly style?: 'primary' | 'danger' | 'default';
}

/** Context about the Claude Code event that triggered the escalation. */
export interface EscalationContext {
  readonly eventType: string;
  readonly toolName?: string;
  readonly filePaths?: readonly string[];
  readonly taskContext?: string;
}

/** A request to escalate something to the human. */
export interface EscalationRequest {
  readonly title: string;
  readonly question: string;
  readonly urgency: UrgencyLevel;
  readonly context: EscalationContext;
  readonly suggestedActions: readonly SuggestedAction[];
  readonly allowFreeformResponse: boolean;
}

/** The human's response to an escalation. */
export interface UserResponse {
  readonly type: ResponseType;
  readonly actionId?: string;
  readonly text?: string;
  readonly respondedAt: Date;
}

/** Timeout configuration when the human is unreachable. Always block (safety first). */
export interface EscalationTimeout {
  readonly type: 'timeout';
  readonly timeoutMs: number;
  readonly fallbackAction: 'block';
}
