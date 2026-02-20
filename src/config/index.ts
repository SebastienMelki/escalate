/**
 * Config module barrel export.
 *
 * Re-exports schema definitions, loader functions, and default values.
 */

// Schema and types
export {
  EscalateConfigSchema,
  UrgencyLevelSchema,
  SlackConfigSchema,
  TimeoutConfigSchema,
  EscalationPolicySchema,
  EventEscalationConfigSchema,
  FallbackActionSchema,
  FallbackActionsConfigSchema,
} from './schema.js';
export type { EscalateConfig } from './schema.js';

// Loader
export { loadConfig, loadSecrets, loadDotEnv } from './loader.js';
export type { ConfigError, ConfigSecrets } from './loader.js';

// Defaults
export {
  DEFAULT_TIMEOUTS,
  DEFAULT_ESCALATION_POLICIES,
  DEFAULT_FALLBACK_ACTIONS,
  DEFAULT_EMOJI_MAPPING,
  DEFAULT_VOICE_NOTES,
  DEFAULT_MULTIMODAL,
} from './defaults.js';
