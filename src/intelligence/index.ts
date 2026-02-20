/**
 * Intelligence module barrel export.
 *
 * Re-exports auto-approval rule evaluation and quiet hours checking.
 */
export {
  evaluateRules,
  extractFilePaths,
  globToRegex,
} from './rules.js';

export type {
  AutoApprovalRule,
  EvaluationInput,
  EvaluationResult,
} from './rules.js';

export {
  isQuietHours,
  isCriticalEvent,
} from './quiet-hours.js';

export type { QuietHoursConfig } from './quiet-hours.js';

export {
  appendAuditEntry,
  readAuditLog,
} from './audit.js';

export type { AuditEntry } from './audit.js';

export {
  triageStopEvent,
  triageWithHeuristic,
  triageWithLlm,
} from './triage.js';

export type { TriageConfig, TriageResult } from './triage.js';

export {
  buildSessionSummary,
  buildSummaryBlocks,
} from './summary.js';

export type { SessionSummary } from './summary.js';
