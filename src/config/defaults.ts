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
  /** How long to wait for a response to stop events (10 min). */
  stop: 600_000,
  /** How long to wait for a response to post-tool-use failures (1 min). */
  postToolUseFailure: 60_000,
} as const;

/** Default escalation policies for each hook event type. */
export const DEFAULT_ESCALATION_POLICIES = {
  /** Always escalate permission requests. */
  permissionRequest: 'always',
  /** Conditionally escalate pre-tool-use (based on urgency analysis). */
  preToolUse: 'conditional',
  /** Always escalate stop events. */
  stop: 'always',
  /** Always escalate post-tool-use failures. */
  postToolUseFailure: 'always',
} as const;

/** Default fallback actions per event type when an escalation times out. */
export const DEFAULT_FALLBACK_ACTIONS = {
  permissionRequest: 'deny',
  preToolUse: 'deny',
  stop: 'ask-again',
  postToolUseFailure: 'allow',
} as const;
