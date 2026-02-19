/**
 * Auto-approval rule evaluation engine.
 *
 * Pure functions for determining whether an escalation should be
 * auto-approved based on tool name patterns or file path globs,
 * or escalated to the human.
 */

/** A rule that can auto-approve an escalation. */
export interface AutoApprovalRule {
  readonly type: 'tool_name' | 'file_path';
  readonly pattern: string;
  readonly description?: string | undefined;
}

/** Input context for rule evaluation. */
export interface EvaluationInput {
  readonly eventType: string;
  readonly toolName?: string;
  readonly filePaths?: readonly string[];
}

/** Result of rule evaluation. */
export interface EvaluationResult {
  readonly decision: 'escalate' | 'auto_approve' | 'quiet_hours_suppress';
  readonly reason: string;
  readonly matchedRule?: AutoApprovalRule;
}

/**
 * Convert a glob pattern to a RegExp.
 *
 * Supports:
 * - `**` matches any number of path segments (including zero)
 * - `*` matches any characters within a single path segment
 * - `?` matches a single non-separator character
 * - `.` is escaped as literal dot
 */
export function globToRegex(glob: string): RegExp {
  let result = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob.charAt(i);

    if (char === '*' && glob.charAt(i + 1) === '*') {
      // `**` — match across path separators
      result += '.*';
      i += 2;
      // Skip trailing `/` after `**`
      if (glob.charAt(i) === '/') {
        i += 1;
      }
    } else if (char === '*') {
      // `*` — match within a single segment (no `/`)
      result += '[^/]*';
      i += 1;
    } else if (char === '?') {
      // `?` — match single non-separator character
      result += '[^/]';
      i += 1;
    } else if (char === '.') {
      result += '\\.';
      i += 1;
    } else {
      result += char;
      i += 1;
    }
  }

  return new RegExp(`^${result}$`);
}

/**
 * Extract file paths from a tool's input parameters.
 *
 * Write, Edit, and Read tools store their target in `file_path`.
 * Bash and other tools do not have a reliable file path field.
 */
export function extractFilePaths(
  toolName: string | undefined,
  toolInput: Record<string, unknown>,
): string[] {
  if (toolName === undefined) {
    return [];
  }

  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'Read': {
      const filePath = toolInput['file_path'];
      return typeof filePath === 'string' ? [filePath] : [];
    }
    default:
      return [];
  }
}

/**
 * Evaluate auto-approval rules against an escalation context.
 *
 * Policy short-circuits:
 * - `always` -> always escalate (rules ignored)
 * - `never` -> always auto-approve (rules ignored)
 * - `conditional` -> iterate rules, auto-approve on first match, escalate if none match
 */
export function evaluateRules(
  input: EvaluationInput,
  rules: readonly AutoApprovalRule[],
  policy: 'always' | 'conditional' | 'never',
): EvaluationResult {
  // Policy short-circuits
  if (policy === 'always') {
    return { decision: 'escalate', reason: 'Policy is always-escalate' };
  }
  if (policy === 'never') {
    return { decision: 'auto_approve', reason: 'Policy is never-escalate' };
  }

  // Conditional: check rules
  for (const rule of rules) {
    if (rule.type === 'tool_name') {
      if (input.toolName !== undefined) {
        const regex = new RegExp(`^(?:${rule.pattern})$`);
        if (regex.test(input.toolName)) {
          return {
            decision: 'auto_approve',
            reason: `Tool "${input.toolName}" matched rule pattern "${rule.pattern}"`,
            matchedRule: rule,
          };
        }
      }
    } else {
      // rule.type === 'file_path'
      const paths = input.filePaths ?? [];
      const regex = globToRegex(rule.pattern);
      for (const filePath of paths) {
        if (regex.test(filePath)) {
          return {
            decision: 'auto_approve',
            reason: `File "${filePath}" matched glob pattern "${rule.pattern}"`,
            matchedRule: rule,
          };
        }
      }
    }
  }

  return { decision: 'escalate', reason: 'No auto-approval rules matched' };
}
