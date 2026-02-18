/**
 * Zod 4 schema definitions for escalate.config.json validation.
 *
 * Validates configuration structure and applies sensible defaults
 * for optional fields (timeouts, escalation policies).
 */
import { z } from 'zod';
import {
  DEFAULT_TIMEOUTS,
  DEFAULT_ESCALATION_POLICIES,
} from './defaults.js';

/** Urgency level for escalation classification. */
export const UrgencyLevelSchema = z.enum(['info', 'warning', 'critical']);

/** Escalation policy controlling when to escalate. */
export const EscalationPolicySchema = z.enum(['always', 'conditional', 'never']);

/** Slack integration configuration. */
export const SlackConfigSchema = z.object({
  /** Slack channel ID to send escalations to. Must be non-empty. */
  channelId: z.string().min(1),
});

/** Timeout configuration (milliseconds) for each hook event type. */
export const TimeoutConfigSchema = z.object({
  permissionRequest: z.number().min(1000).default(DEFAULT_TIMEOUTS.permissionRequest),
  preToolUse: z.number().min(1000).default(DEFAULT_TIMEOUTS.preToolUse),
  stop: z.number().min(1000).default(DEFAULT_TIMEOUTS.stop),
  postToolUseFailure: z.number().min(1000).default(DEFAULT_TIMEOUTS.postToolUseFailure),
});

/** Per-event escalation policy configuration. */
export const EventEscalationConfigSchema = z.object({
  permissionRequest: EscalationPolicySchema.default(DEFAULT_ESCALATION_POLICIES.permissionRequest),
  preToolUse: EscalationPolicySchema.default(DEFAULT_ESCALATION_POLICIES.preToolUse),
  stop: EscalationPolicySchema.default(DEFAULT_ESCALATION_POLICIES.stop),
  postToolUseFailure: EscalationPolicySchema.default(DEFAULT_ESCALATION_POLICIES.postToolUseFailure),
});

/** Root configuration schema for escalate.config.json. */
export const EscalateConfigSchema = z.object({
  slack: SlackConfigSchema,
  // Zod 4: .default({}) does NOT apply inner field defaults, so we provide
  // fully-resolved default objects from our constants.
  timeouts: TimeoutConfigSchema.default({ ...DEFAULT_TIMEOUTS }),
  escalationPolicies: EventEscalationConfigSchema.default({ ...DEFAULT_ESCALATION_POLICIES }),
});

/** Validated configuration type inferred from the Zod schema. */
export type EscalateConfig = z.infer<typeof EscalateConfigSchema>;
