/**
 * Barrel re-export for all core types.
 */
export type {
  UrgencyLevel,
  ResponseType,
  SuggestedAction,
  EscalationContext,
  EscalationRequest,
  UserResponse,
  EscalationTimeout,
} from './escalation.js';

export type { MessagingAdapter } from './adapter.js';
