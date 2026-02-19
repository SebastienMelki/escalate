/**
 * Slack module barrel exports.
 *
 * Re-exports the adapter, block builders, types, and handler functions
 * for use by the server entrypoint and external consumers.
 */

// Adapter
export { SlackAdapter } from './adapter.js';
export type { SlackAdapterOptions } from './adapter.js';

// Block Kit builders
export { buildEscalationBlocks, buildConfirmationBlocks, buildFallbackText } from './blocks.js';

// Internal types
export type { EscalationMessage, ButtonStyle, SlackAdapterState } from './types.js';

// Handler registration
export { registerActionHandler, registerMessageHandler } from './handlers.js';
export type { SlackAdapterCallbacks } from './handlers.js';
