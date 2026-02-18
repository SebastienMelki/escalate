/**
 * Escalate - Smart escalation bridge between Claude Code and messaging platforms.
 *
 * Entry point: re-exports core types and utilities.
 */

// Core types
export type {
  UrgencyLevel,
  ResponseType,
  SuggestedAction,
  EscalationContext,
  EscalationRequest,
  UserResponse,
  EscalationTimeout,
  MessagingAdapter,
} from './types/index.js';

// Error handling utilities
export { ok, err, isOk, isErr, unwrapOr } from './errors/result.js';
export type { Result } from './errors/result.js';

// Config module
export {
  EscalateConfigSchema,
  UrgencyLevelSchema,
  SlackConfigSchema,
  TimeoutConfigSchema,
  EscalationPolicySchema,
  EventEscalationConfigSchema,
  loadConfig,
  loadSecrets,
  DEFAULT_TIMEOUTS,
  DEFAULT_ESCALATION_POLICIES,
} from './config/index.js';
export type { EscalateConfig, ConfigError, ConfigSecrets } from './config/index.js';
