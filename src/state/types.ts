/**
 * Type definitions for the escalation state store.
 *
 * These types represent the SQLite-persisted escalation records and
 * their creation parameters.
 */

/** Action taken when an escalation times out without a response. */
export type FallbackAction = 'allow' | 'deny' | 'ask-again';

/** Lifecycle status of an escalation record. */
export type EscalationStatus = 'pending' | 'resolved' | 'timed_out';

/** A persisted escalation record from the SQLite store. */
export interface EscalationRecord {
  readonly id: string;
  readonly status: EscalationStatus;
  readonly eventType: string;
  readonly requestJson: string;
  readonly responseJson: string | null;
  readonly fallbackAction: FallbackAction;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly timeoutAt: string;
}

/** Parameters for creating a new escalation record. */
export interface CreateEscalationParams {
  readonly eventType: string;
  readonly requestJson: string;
  readonly fallbackAction: FallbackAction;
  readonly timeoutSeconds: number;
}
