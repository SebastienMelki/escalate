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
  FallbackActionSchema,
  FallbackActionsConfigSchema,
  loadConfig,
  loadSecrets,
  DEFAULT_TIMEOUTS,
  DEFAULT_ESCALATION_POLICIES,
  DEFAULT_FALLBACK_ACTIONS,
} from './config/index.js';
export type { EscalateConfig, ConfigError, ConfigSecrets } from './config/index.js';

// State module
export { EscalationStore, initializeDatabase } from './state/index.js';
export type {
  EscalationRecord,
  EscalationStatus,
  FallbackAction,
  CreateEscalationParams,
} from './state/index.js';

// Server module
export { createMcpServer } from './server/mcp-server.js';
export { createHttpBridge } from './server/http-bridge.js';
export { startServer } from './server/index.js';

// Transcription module
export type { TranscriptionProvider, TranscriptionResult } from './transcription/index.js';
export { WhisperTranscriptionProvider } from './transcription/whisper.js';

// Slack module
export { SlackAdapter } from './slack/index.js';
export type { SlackAdapterOptions } from './slack/index.js';
export {
  buildEscalationBlocks,
  buildConfirmationBlocks,
  buildFallbackText,
} from './slack/index.js';
