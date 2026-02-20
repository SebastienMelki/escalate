/**
 * Default configuration values for escalation timeouts and policies.
 *
 * Timeouts are in milliseconds.
 * Policies control when escalation occurs for each hook event type.
 */

/** Default timeout values (milliseconds) for each hook event type. */
export const DEFAULT_TIMEOUTS = {
  /** How long to wait for a response to permission requests (10 min). */
  permissionRequest: 600_000,
  /** How long to wait for a response to pre-tool-use checks (5 min). */
  preToolUse: 300_000,
  /** How long to wait for a response to stop events (30 sec). */
  stop: 30_000,
  /** How long to wait for a response to post-tool-use failures (1 min). */
  postToolUseFailure: 60_000,
} as const;

/** Default escalation policies for each hook event type. */
export const DEFAULT_ESCALATION_POLICIES = {
  /** Always escalate permission requests. */
  permissionRequest: 'always',
  /** Conditionally escalate pre-tool-use (based on urgency analysis). */
  preToolUse: 'conditional',
  /** Always escalate stop events (triage filters out completions). */
  stop: 'always',
  /** Always escalate post-tool-use failures. */
  postToolUseFailure: 'always',
} as const;

/** Default fallback actions per event type when an escalation times out. */
export const DEFAULT_FALLBACK_ACTIONS = {
  permissionRequest: 'deny',
  preToolUse: 'deny',
  stop: 'allow',
  postToolUseFailure: 'allow',
} as const;

/** Default quiet hours configuration (disabled by default). */
export const DEFAULT_QUIET_HOURS = {
  enabled: false,
  start: '22:00',
  end: '07:00',
  timezone: 'UTC',
  criticalEvents: ['PermissionRequest', 'Stop'],
} as const;

/** Default emoji-to-action mapping for reaction responses. */
export const DEFAULT_EMOJI_MAPPING = {
  white_check_mark: 'approve',
  heavy_check_mark: 'approve',
  thumbsup: 'approve',
  x: 'deny',
  no_entry_sign: 'deny',
  thumbsdown: 'deny',
} as const;

/** Default voice notes configuration (disabled by default). */
export const DEFAULT_VOICE_NOTES = {
  enabled: false,
  provider: 'whisper' as const,
  maxDurationSeconds: 120,
  maxFileSizeMb: 10,
} as const;

/** Default triage configuration for LLM-powered Stop event classification. */
export const DEFAULT_TRIAGE = {
  enabled: true,
  method: 'auto' as const,
  model: 'claude-haiku-4-5-20251001',
  confidenceThreshold: 'low' as const,
} as const;

/** Default multimodal configuration (emoji reactions on, voice notes off). */
export const DEFAULT_MULTIMODAL = {
  emojiReactions: { enabled: true, mapping: { ...DEFAULT_EMOJI_MAPPING } },
  voiceNotes: { ...DEFAULT_VOICE_NOTES },
} as const;
