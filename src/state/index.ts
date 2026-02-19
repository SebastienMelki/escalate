/**
 * State module barrel export.
 *
 * Re-exports types, schema initialization, and the EscalationStore.
 */

// Types
export type {
  FallbackAction,
  EscalationStatus,
  EscalationRecord,
  CreateEscalationParams,
} from './types.js';

// Schema
export { initializeDatabase } from './schema.js';

// Store
export { EscalationStore } from './store.js';
