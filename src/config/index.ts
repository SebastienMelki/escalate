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
} from './schema.js';
export type { EscalateConfig } from './schema.js';

// Loader
export { loadConfig, loadSecrets } from './loader.js';
export type { ConfigError, ConfigSecrets } from './loader.js';

// Defaults
export { DEFAULT_TIMEOUTS, DEFAULT_ESCALATION_POLICIES } from './defaults.js';
