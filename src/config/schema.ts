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
  DEFAULT_FALLBACK_ACTIONS,
  DEFAULT_QUIET_HOURS,
  DEFAULT_EMOJI_MAPPING,
  DEFAULT_VOICE_NOTES,
  DEFAULT_MULTIMODAL,
  DEFAULT_TRIAGE,
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
  postToolUseFailure: EscalationPolicySchema.default(
    DEFAULT_ESCALATION_POLICIES.postToolUseFailure,
  ),
});

/** Fallback action when an escalation times out. */
export const FallbackActionSchema = z.enum(['allow', 'deny', 'ask-again']);

/** Per-event fallback action configuration. */
export const FallbackActionsConfigSchema = z.object({
  permissionRequest: FallbackActionSchema.default(DEFAULT_FALLBACK_ACTIONS.permissionRequest),
  preToolUse: FallbackActionSchema.default(DEFAULT_FALLBACK_ACTIONS.preToolUse),
  stop: FallbackActionSchema.default(DEFAULT_FALLBACK_ACTIONS.stop),
  postToolUseFailure: FallbackActionSchema.default(DEFAULT_FALLBACK_ACTIONS.postToolUseFailure),
});

/** Auto-approval rule schema for conditional escalation bypass. */
export const AutoApprovalRuleSchema = z.object({
  type: z.enum(['tool_name', 'file_path']),
  pattern: z.string().min(1),
  description: z.string().optional(),
});

/** Quiet hours configuration schema for time-based escalation suppression. */
export const QuietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  start: z.string().regex(/^\d{2}:\d{2}$/).default('22:00'),
  end: z.string().regex(/^\d{2}:\d{2}$/).default('07:00'),
  timezone: z.string().default('UTC'),
  criticalEvents: z.array(z.string()).default(['PermissionRequest', 'Stop']),
});

/** Emoji name-to-action mapping schema. */
export const EmojiMappingSchema = z
  .record(z.string(), z.string())
  .default({ ...DEFAULT_EMOJI_MAPPING });

/** Emoji reactions configuration schema. */
export const EmojiReactionsSchema = z.object({
  enabled: z.boolean().default(true),
  mapping: EmojiMappingSchema,
});

/** Voice note transcription configuration schema. */
export const VoiceNoteConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['whisper']).default('whisper'),
  maxDurationSeconds: z.number().min(1).max(300).default(120),
  maxFileSizeMb: z.number().min(1).max(25).default(10),
});

/** Multimodal response configuration schema (emoji reactions + voice notes). */
export const MultimodalConfigSchema = z.object({
  emojiReactions: EmojiReactionsSchema.default({
    enabled: true,
    mapping: { ...DEFAULT_EMOJI_MAPPING },
  }),
  voiceNotes: VoiceNoteConfigSchema.default({ ...DEFAULT_VOICE_NOTES }),
});

/** Triage configuration schema for LLM-powered Stop event classification. */
export const TriageConfigSchema = z.object({
  enabled: z.boolean().default(true),
  method: z.enum(['auto', 'llm', 'heuristic']).default('auto'),
  model: z.string().default('claude-haiku-4-5-20251001'),
  confidenceThreshold: z.enum(['high', 'medium', 'low']).default('low'),
});

/** Audit log configuration schema. */
export const AuditLogSchema = z.object({
  enabled: z.boolean().default(true),
});

/** Root configuration schema for escalate.config.json. */
export const EscalateConfigSchema = z.object({
  slack: SlackConfigSchema,
  // Zod 4: .default({}) does NOT apply inner field defaults, so we provide
  // fully-resolved default objects from our constants.
  timeouts: TimeoutConfigSchema.default({ ...DEFAULT_TIMEOUTS }),
  escalationPolicies: EventEscalationConfigSchema.default({ ...DEFAULT_ESCALATION_POLICIES }),
  fallbackActions: FallbackActionsConfigSchema.default({ ...DEFAULT_FALLBACK_ACTIONS }),
  autoApprovalRules: z.array(AutoApprovalRuleSchema).default([]),
  quietHours: QuietHoursSchema.default({
    ...DEFAULT_QUIET_HOURS,
    criticalEvents: [...DEFAULT_QUIET_HOURS.criticalEvents],
  }),
  multimodal: MultimodalConfigSchema.default({ ...DEFAULT_MULTIMODAL }),
  triage: TriageConfigSchema.default({ ...DEFAULT_TRIAGE }),
  auditLog: AuditLogSchema.default({ enabled: true }),
});

/** Validated configuration type inferred from the Zod schema. */
export type EscalateConfig = z.infer<typeof EscalateConfigSchema>;
