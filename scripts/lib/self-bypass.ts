/**
 * Self-bypass guard for escalate plugin hooks.
 *
 * Prevents recursive escalation by detecting when a tool being requested
 * belongs to the escalate plugin itself (its MCP tools). Without this guard,
 * every MCP call the plugin makes would trigger another escalation, creating
 * an infinite chain.
 *
 * Also prevents double escalation when both PermissionRequest and PreToolUse
 * hooks fire for the same tool. The PermissionRequest hook should skip tools
 * that are already covered by the PreToolUse matcher.
 */

/** Prefix used by Claude Code for escalate plugin MCP tools. */
const ESCALATE_MCP_PREFIX = 'mcp__plugin_escalate_escalate__';

/**
 * Tools covered by the PreToolUse hook matcher (from hooks.json).
 *
 * The PermissionRequest hook should skip these to avoid double escalation.
 * When both hooks fire for the same tool, the user would have to approve
 * two separate Slack messages for one action.
 */
const PRE_TOOL_USE_COVERED = new Set(['Bash', 'Write', 'Edit']);

/**
 * Check if a tool name belongs to the escalate plugin's own MCP server.
 */
export function isEscalateInternalTool(toolName: string): boolean {
  return toolName.startsWith(ESCALATE_MCP_PREFIX);
}

/**
 * Check if a tool is already covered by the PreToolUse hook.
 *
 * Used by the PermissionRequest hook to avoid sending two Slack messages
 * for one tool call. PreToolUse handles Bash/Write/Edit with its own
 * escalation flow, so PermissionRequest should auto-approve these.
 */
export function isCoveredByPreToolUse(toolName: string): boolean {
  return PRE_TOOL_USE_COVERED.has(toolName);
}

/**
 * Pre-built auto-approve JSON outputs for each hook event type.
 *
 * Used to immediately allow the escalate plugin's own tools without
 * going through the escalation flow.
 */
export const AUTO_APPROVE_OUTPUT = {
  permissionRequest: JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  }),
  preToolUse: JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  }),
} as const;
