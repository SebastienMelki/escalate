# Phase 5: Escalation Intelligence - Research

**Researched:** 2026-02-19
**Domain:** Auto-approval rule matching, audit logging, timezone-aware quiet hours, session summary DMs
**Confidence:** HIGH

## Summary

Phase 5 adds intelligence to the escalation pipeline. Currently, every matching hook event is escalated to Slack regardless of context. Phase 5 introduces a decision layer between the hook script receiving an event and sending it to Slack. This layer evaluates auto-approval rules (tool name patterns, file path patterns), checks quiet hours schedules, records every decision to an audit log, and sends session summary DMs on TaskCompleted or Stop events.

The key architectural insight is that all intelligence logic belongs in the HTTP bridge handler (server-side), not in the hook scripts. Hook scripts remain thin dispatchers. The HTTP bridge's `POST /escalations` handler currently creates a SQLite record and fires off a Slack message unconditionally. Phase 5 intercepts this flow: before creating an escalation, evaluate rules. If auto-approved, short-circuit without sending to Slack. If during quiet hours, auto-handle non-critical events. Either way, log the decision to the audit file.

No new npm dependencies are required. The existing stack (Zod for schema validation, better-sqlite3 for state, @slack/bolt for messaging, Node.js built-in fs for file I/O) covers all Phase 5 needs. Timezone handling uses the IANA timezone database built into Node.js 22's `Intl.DateTimeFormat`. Glob pattern matching for file paths uses Node.js built-in `RegExp` conversion from simple glob syntax (no micromatch or minimatch needed for the supported patterns).

**Primary recommendation:** Add a new `src/intelligence/` module with three pure-function submodules: `rules.ts` (auto-approval evaluation), `quiet-hours.ts` (time-based suppression), and `audit.ts` (append-only JSON logging). Wire them into the HTTP bridge handler. Add new hook registrations for `TaskCompleted` and `Stop` to trigger session summaries. Extend the config schema with `autoApprovalRules`, `quietHours`, and `auditLog` sections.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CFG-02 | Escalation triggers configurable per event type with policies: always escalate, never escalate, or conditional (pattern-based) | Config schema already has `escalationPolicies` with `always`/`conditional`/`never` per event type. Phase 5 adds the "conditional" rule definitions: tool name patterns and file path patterns under a new `autoApprovalRules` config section. The `conditional` policy evaluates rules; `always` bypasses rules and always escalates; `never` bypasses rules and never escalates. |
| INTL-01 | Auto-approval rules match tool name patterns (e.g., auto-approve all Read tool calls) | Hook stdin JSON includes `tool_name` field for PreToolUse and PermissionRequest events. A `toolPatterns` array in config contains regex strings matched against `tool_name`. If any pattern matches and the escalation policy is `conditional`, the event is auto-approved without Slack escalation. The HTTP bridge handler performs the match before creating an escalation record. |
| INTL-02 | Auto-approval rules match file path patterns (e.g., auto-approve writes to test files) | Hook stdin JSON includes `tool_input.file_path` for Write/Edit tools and `tool_input.command` for Bash. A `filePatterns` array in config contains glob-style patterns (e.g., `**/test/**`, `**/*.test.ts`) matched against extracted file paths. File path extraction is event-type-specific: Write/Edit provide `file_path` directly; Bash requires simple command parsing (best-effort). |
| INTL-03 | Audit log -- append-only JSON file recording every escalation: timestamp, event type, message sent, response received, decision applied | A new `src/intelligence/audit.ts` module appends one JSON line per event to a configurable log file (default: `$CLAUDE_PROJECT_DIR/.claude/escalate-audit.jsonl`). Each line contains: `timestamp` (ISO 8601), `eventType`, `toolName`, `decision` (escalated/auto-approved/quiet-hours-suppressed/timed-out), `messagePreview` (truncated question text), `responseJson` (user response if any), `ruleThatMatched` (which auto-approval rule triggered). Uses `fs.appendFileSync` for atomicity. |
| INTL-04 | Quiet hours -- time-based escalation suppression with configurable schedule and timezone; only critical escalations (PermissionRequest, Stop) during quiet hours | A new `quietHours` config section with `enabled`, `start` (HH:MM), `end` (HH:MM), `timezone` (IANA string), and `criticalEventsOnly` (list of event types that bypass quiet hours). During quiet hours, non-critical events are auto-handled per their `fallbackActions` config. Critical events (default: PermissionRequest, Stop) still escalate to Slack. Uses `Intl.DateTimeFormat` with `timeZone` option to get current time in the configured timezone. |
| INTL-05 | Session summary DM on TaskCompleted or Stop -- phases completed, decisions made, notable events | Requires new hook registrations for `TaskCompleted` and `Stop` (summary variant). On these events, the hook script sends a summary request to the HTTP bridge via a new `POST /summary` endpoint. The bridge reads the audit log, aggregates statistics (total events, auto-approved count, escalated count, decisions by type), and sends a formatted Slack DM via the adapter's `sendFollowUp` or a new `sendSummary` method. The summary is a Block Kit message listing: event counts, decisions made, notable events (failures, denials). |
</phase_requirements>

## Standard Stack

### Core

No new libraries are needed. Phase 5 uses only what is already installed.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `Intl.DateTimeFormat` | Node 22+ | Timezone-aware time comparison for quiet hours | Built-in IANA timezone database. Zero dependencies. Handles DST transitions correctly |
| Node.js `fs.appendFileSync` | Node 22+ | Append-only audit log writes | Atomic per-line append. No file locking needed for single-process append |
| Node.js `RegExp` | Node 22+ | Tool name pattern matching and file path glob-to-regex conversion | Built-in. No external pattern matching library needed for the supported patterns |
| Zod (existing) | ^4.3.6 | Schema validation for new config sections (autoApprovalRules, quietHours, auditLog) | Already used throughout codebase for config validation |
| better-sqlite3 (existing) | ^12.6.2 | Query audit data for session summaries (optional -- could also read JSONL directly) | Already used for escalation state. Summary queries could use SQLite aggregation |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest (existing) | ^4.0.18 | Unit tests for rule matching, quiet hours evaluation, audit log formatting | Test all pure-function logic in isolation |
| tsup (existing) | ^8.5.1 | Bundle new hook scripts for TaskCompleted/Stop summary dispatch | Add new entry points if new hook scripts are needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RegExp for glob matching | `minimatch` or `micromatch` | External dependency. The patterns we need are simple (`**/test/**`, `*.test.ts`). A 10-line glob-to-regex converter handles these cases. Use minimatch only if users report edge cases |
| `Intl.DateTimeFormat` for timezone | `luxon` or `date-fns-tz` | External dependency. We only need "what is the current hour:minute in timezone X?" -- one API call to Intl handles this. No date arithmetic, parsing, or formatting needed |
| JSONL file for audit log | SQLite audit table | SQLite would allow richer queries but introduces coupling between audit and escalation databases. JSONL is simpler, append-only, human-readable, and trivially parseable for summaries. Better separation of concerns |
| New hook scripts for summary | HTTP bridge-triggered summary on session events | Could skip new hook scripts entirely and have the HTTP bridge detect Stop/TaskCompleted events and trigger summaries automatically. But this violates the "hooks are the event source" pattern. Keep it consistent |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure

```
escalate/
├── src/
│   ├── intelligence/
│   │   ├── index.ts            # Barrel export
│   │   ├── rules.ts            # Auto-approval rule evaluation (pure functions)
│   │   ├── quiet-hours.ts      # Quiet hours time-based check (pure functions)
│   │   ├── audit.ts            # Append-only audit log writer
│   │   └── summary.ts          # Session summary builder (reads audit, formats)
│   ├── config/
│   │   ├── schema.ts           # Extended with autoApprovalRules, quietHours sections
│   │   └── defaults.ts         # Extended with default rule/quiet-hours values
│   ├── server/
│   │   ├── http-bridge.ts      # Modified: add intelligence evaluation before escalation
│   │   └── ...
│   └── ...
├── scripts/
│   ├── on-task-completed.ts    # NEW: TaskCompleted hook for session summary
│   ├── on-stop.ts              # MODIFIED: add summary dispatch after stop decision
│   └── ...
├── hooks/
│   └── hooks.json              # MODIFIED: add TaskCompleted hook registration
└── test/
    ├── intelligence/
    │   ├── rules.test.ts       # Rule matching unit tests
    │   ├── quiet-hours.test.ts # Quiet hours evaluation tests
    │   ├── audit.test.ts       # Audit log write/read tests
    │   └── summary.test.ts     # Summary builder tests
    └── ...
```

### Pattern 1: Intelligence Evaluation Pipeline

**What:** A pure-function pipeline that takes an escalation event and returns a decision (escalate, auto-approve, or suppress). The pipeline runs in the HTTP bridge handler before creating an escalation record or sending a Slack message.

**When to use:** Every time `POST /escalations` is called by a hook script.

**Example:**

```typescript
// src/intelligence/rules.ts

export interface AutoApprovalRule {
  readonly type: 'tool_name' | 'file_path';
  readonly pattern: string; // Regex string for tool_name, glob for file_path
  readonly description?: string;
}

export interface EvaluationInput {
  readonly eventType: string;
  readonly toolName?: string;
  readonly filePaths?: readonly string[];
}

export interface EvaluationResult {
  readonly decision: 'escalate' | 'auto_approve' | 'quiet_hours_suppress';
  readonly reason: string;
  readonly matchedRule?: AutoApprovalRule;
}

/**
 * Evaluate whether an event should be auto-approved based on rules.
 * Pure function -- no side effects.
 */
export function evaluateRules(
  input: EvaluationInput,
  rules: readonly AutoApprovalRule[],
  policy: 'always' | 'conditional' | 'never',
): EvaluationResult {
  // Policy short-circuits
  if (policy === 'never') {
    return { decision: 'auto_approve', reason: 'Policy: never escalate' };
  }
  if (policy === 'always') {
    return { decision: 'escalate', reason: 'Policy: always escalate' };
  }

  // Conditional: evaluate rules
  for (const rule of rules) {
    if (rule.type === 'tool_name' && input.toolName) {
      if (new RegExp(rule.pattern).test(input.toolName)) {
        return { decision: 'auto_approve', reason: `Tool name matched: ${rule.pattern}`, matchedRule: rule };
      }
    }
    if (rule.type === 'file_path' && input.filePaths) {
      const regex = globToRegex(rule.pattern);
      if (input.filePaths.some(fp => regex.test(fp))) {
        return { decision: 'auto_approve', reason: `File path matched: ${rule.pattern}`, matchedRule: rule };
      }
    }
  }

  // No rules matched -- escalate
  return { decision: 'escalate', reason: 'No auto-approval rules matched' };
}
```

### Pattern 2: Quiet Hours Guard

**What:** A time-based check that suppresses non-critical escalations during configured quiet hours. Runs after rule evaluation (a quiet-hours-suppressed event is still logged to the audit).

**When to use:** In the HTTP bridge handler, after rule evaluation but before Slack dispatch.

**Example:**

```typescript
// src/intelligence/quiet-hours.ts

export interface QuietHoursConfig {
  readonly enabled: boolean;
  readonly start: string; // "22:00"
  readonly end: string;   // "07:00"
  readonly timezone: string; // "America/New_York"
  readonly criticalEvents: readonly string[]; // ["PermissionRequest", "Stop"]
}

/**
 * Check if the current time falls within quiet hours.
 * Pure function when `now` is injected for testability.
 */
export function isQuietHours(
  config: QuietHoursConfig,
  now: Date = new Date(),
): boolean {
  if (!config.enabled) return false;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const currentMinutes = hour * 60 + minute;

  const [startH, startM] = config.start.split(':').map(Number);
  const [endH, endM] = config.end.split(':').map(Number);
  const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
  const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

  // Handle overnight ranges (e.g., 22:00 - 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Check if an event type is considered critical (bypasses quiet hours).
 */
export function isCriticalEvent(
  eventType: string,
  criticalEvents: readonly string[],
): boolean {
  return criticalEvents.includes(eventType);
}
```

### Pattern 3: Append-Only Audit Log

**What:** Every escalation decision (whether auto-approved, escalated, or suppressed) is appended as a single JSON line to a JSONL file. The log is append-only and never truncated during a session.

**When to use:** After every decision in the HTTP bridge handler.

**Example:**

```typescript
// src/intelligence/audit.ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEntry {
  readonly timestamp: string; // ISO 8601
  readonly eventType: string;
  readonly toolName?: string;
  readonly filePaths?: readonly string[];
  readonly decision: 'escalated' | 'auto_approved' | 'quiet_hours_suppressed' | 'timed_out';
  readonly reason: string;
  readonly matchedRule?: string; // Rule description
  readonly messagePreview?: string; // Truncated question text
  readonly responseJson?: string; // User response if any
  readonly escalationId?: string; // SQLite record ID if created
}

/**
 * Append a single audit entry to the log file.
 * Creates parent directories if they don't exist.
 */
export function appendAuditEntry(logPath: string, entry: AuditEntry): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
}
```

### Pattern 4: Session Summary Builder

**What:** Reads the audit log, aggregates statistics, and produces a Block Kit formatted Slack message summarizing the session.

**When to use:** On TaskCompleted or Stop events, triggered by hook script via HTTP bridge.

**Example:**

```typescript
// src/intelligence/summary.ts
import { readFileSync, existsSync } from 'node:fs';
import type { AuditEntry } from './audit.js';

export interface SessionSummary {
  readonly totalEvents: number;
  readonly autoApproved: number;
  readonly escalated: number;
  readonly quietHoursSuppressed: number;
  readonly timedOut: number;
  readonly decisionsByType: Record<string, number>;
  readonly notableEvents: readonly string[]; // Failures, denials, etc.
}

export function buildSessionSummary(logPath: string): SessionSummary {
  if (!existsSync(logPath)) {
    return {
      totalEvents: 0, autoApproved: 0, escalated: 0,
      quietHoursSuppressed: 0, timedOut: 0,
      decisionsByType: {}, notableEvents: [],
    };
  }

  const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  const entries = lines.map(line => JSON.parse(line) as AuditEntry);

  // Aggregate statistics...
  return {
    totalEvents: entries.length,
    autoApproved: entries.filter(e => e.decision === 'auto_approved').length,
    escalated: entries.filter(e => e.decision === 'escalated').length,
    quietHoursSuppressed: entries.filter(e => e.decision === 'quiet_hours_suppressed').length,
    timedOut: entries.filter(e => e.decision === 'timed_out').length,
    decisionsByType: groupBy(entries, e => e.eventType),
    notableEvents: entries
      .filter(e => e.decision === 'timed_out' || e.eventType === 'PostToolUseFailure')
      .map(e => `${e.eventType}: ${e.reason}`),
  };
}
```

### Pattern 5: File Path Extraction from Hook Input

**What:** Extract file paths from the hook event's `tool_input` field for file-path-based auto-approval matching. Different tools provide file paths in different fields.

**When to use:** When evaluating file path auto-approval rules (INTL-02).

**Example:**

```typescript
// src/intelligence/rules.ts

/**
 * Extract file paths from hook event input JSON.
 * Returns empty array if no file paths can be determined.
 */
export function extractFilePaths(
  toolName: string | undefined,
  toolInput: Record<string, unknown>,
): string[] {
  if (!toolName) return [];

  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'Read': {
      const filePath = toolInput['file_path'];
      return typeof filePath === 'string' ? [filePath] : [];
    }
    case 'Bash': {
      // Best-effort: extract paths from command string
      // This is intentionally limited -- complex commands are not parsed
      return [];
    }
    default:
      return [];
  }
}
```

### Anti-Patterns to Avoid

- **Rule evaluation in hook scripts:** Auto-approval rules MUST be evaluated server-side in the HTTP bridge, not in hook scripts. Hook scripts should not read escalate.config.json directly for rule evaluation -- they dispatch to the bridge and the bridge decides.
- **Mutable audit log:** The audit log is append-only. Never delete, truncate, or modify existing entries during a session. A new session can optionally archive or rotate the previous log.
- **Blocking on audit writes:** `appendFileSync` is synchronous but fast (single line append). If the audit file is on a slow filesystem, this could block the HTTP bridge. For v1, this is acceptable (local filesystem). If this becomes a bottleneck, switch to buffered async writes.
- **Hardcoded timezone:** Always use the configured timezone, never `Date.getHours()` which uses the server's local timezone. The user may run Claude Code in a different timezone than their Slack app.
- **Over-parsing Bash commands for file paths:** Extracting file paths from arbitrary shell commands is an unsolvable problem in general. For Bash tool, do NOT try to parse complex pipelines. Accept that Bash auto-approval is tool-name-only (INTL-01), not file-path-based (INTL-02). File path matching applies to Write/Edit/Read tools where `file_path` is an explicit field.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timezone-aware time comparison | Manual UTC offset calculation | `Intl.DateTimeFormat` with `timeZone` option | Handles DST transitions, IANA timezone names, no external dependency |
| Glob-to-regex conversion | Full glob parser | Simple `globToRegex()` helper (10 lines) | Only need `*`, `**`, and `?` patterns. No brace expansion, negation, or extglob needed |
| Audit log rotation | Custom log rotation system | Simple file rename on session start | Log files are small (one line per event, ~200 bytes each). A 1000-event session produces ~200KB. No rotation needed within a session |
| Session statistics aggregation | SQLite audit table with GROUP BY | `Array.reduce()` over JSONL entries | JSONL files are small enough to parse in memory. SQLite aggregation adds coupling |
| Cron-style schedule parsing | cron expression parser | Simple `HH:MM` start/end with timezone | Quiet hours is a single daily window, not a cron schedule. `HH:MM` is sufficient |

**Key insight:** Phase 5's intelligence features are all implementable with pure functions and Node.js built-ins. The temptation to add external dependencies (minimatch, luxon, cron-parser) should be resisted -- the use cases are narrow enough that simple custom solutions are more maintainable and have fewer edge cases.

## Common Pitfalls

### Pitfall 1: Rule Evaluation Races with Slack Dispatch

**What goes wrong:** The HTTP bridge evaluates rules and decides to auto-approve, but the Slack message was already sent because the adapter was called before rule evaluation.
**Why it happens:** The current `POST /escalations` handler creates the SQLite record AND calls `adapter.sendEscalation()` in the same handler. If rule evaluation is added after the Slack call, the auto-approval is meaningless.
**How to avoid:** Restructure the POST handler: (1) parse input, (2) evaluate rules, (3) if auto-approve: create SQLite record with status 'resolved' (pre-resolved), log to audit, return immediately. (4) if escalate: create SQLite record with status 'pending', send Slack message, log to audit.
**Warning signs:** Slack messages appear for events that should have been auto-approved.

### Pitfall 2: Quiet Hours Overnight Range

**What goes wrong:** Quiet hours configured as `22:00 - 07:00` (overnight) are evaluated as `22:00 - 07:00` using simple comparison, which is always false (22 > 7).
**Why it happens:** Naive time range check: `current >= start && current <= end` fails when start > end.
**How to avoid:** Detect overnight ranges (start > end) and split the check: `current >= start || current < end`. The code example above handles this correctly.
**Warning signs:** Quiet hours events being escalated after 10 PM.

### Pitfall 3: Audit Log File Not Found on Summary

**What goes wrong:** The summary builder crashes because the audit log file does not exist (no events were logged yet in this session).
**Why it happens:** The audit log is created on first write. If no escalation events occurred, the file does not exist.
**How to avoid:** Check `existsSync()` before reading. Return an empty summary if the file does not exist. Never crash on missing audit log.
**Warning signs:** TaskCompleted hook script crashes with ENOENT.

### Pitfall 4: Config Schema Migration Breaking Existing Users

**What goes wrong:** Adding new required fields to the config schema causes validation failure for users with existing `escalate.config.json` files that don't have the new fields.
**Why it happens:** New config sections (autoApprovalRules, quietHours, auditLog) are required without defaults.
**How to avoid:** All new config sections MUST have `.default()` values in the Zod schema. `autoApprovalRules` defaults to `[]`. `quietHours` defaults to `{ enabled: false, ... }`. `auditLog` defaults to `{ enabled: true, path: ... }`. Existing config files continue to validate without changes.
**Warning signs:** Config validation errors on startup after upgrading.

### Pitfall 5: Session Summary Hook Re-entry

**What goes wrong:** The Stop hook sends a session summary to Slack, but the summary Slack message itself triggers another Stop event, causing infinite loop.
**Why it happens:** Sending a Slack message from a Stop hook could be misinterpreted as session activity.
**How to avoid:** Session summaries are sent from the HTTP bridge (server-side), not from the hook script. The hook script just triggers the summary by calling `POST /summary`. The bridge sends the Slack message via the adapter. There is no re-entry because Slack messages sent by the MCP server do not trigger hook events. Additionally, the existing `stop_hook_active` guard in the Stop hook prevents re-entry.
**Warning signs:** Multiple summary messages in Slack.

### Pitfall 6: Auto-Approval Without Audit Trail

**What goes wrong:** Auto-approved events are silently approved but not logged. The user has no visibility into what was auto-approved.
**Why it happens:** Developer adds rule evaluation that short-circuits before the audit log write.
**How to avoid:** The audit log write MUST happen for every decision, including auto-approvals and quiet hours suppressions. The evaluation pipeline returns a result, and the bridge handler ALWAYS logs it before acting on the decision.
**Warning signs:** Audit log is missing entries. User cannot explain why certain events were not escalated.

## Code Examples

### Config Schema Extension

```typescript
// src/config/schema.ts -- additions

/** A single auto-approval rule. */
export const AutoApprovalRuleSchema = z.object({
  type: z.enum(['tool_name', 'file_path']),
  pattern: z.string().min(1),
  description: z.string().optional(),
});

/** Quiet hours configuration. */
export const QuietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  start: z.string().regex(/^\d{2}:\d{2}$/).default('22:00'),
  end: z.string().regex(/^\d{2}:\d{2}$/).default('07:00'),
  timezone: z.string().default('UTC'),
  criticalEvents: z.array(z.string()).default(['PermissionRequest', 'Stop']),
});

/** Audit log configuration. */
export const AuditLogSchema = z.object({
  enabled: z.boolean().default(true),
  // Path resolved at runtime relative to CLAUDE_PROJECT_DIR
});

/** Extended root config schema. */
export const EscalateConfigSchema = z.object({
  slack: SlackConfigSchema,
  timeouts: TimeoutConfigSchema.default({ ...DEFAULT_TIMEOUTS }),
  escalationPolicies: EventEscalationConfigSchema.default({ ...DEFAULT_ESCALATION_POLICIES }),
  fallbackActions: FallbackActionsConfigSchema.default({ ...DEFAULT_FALLBACK_ACTIONS }),
  autoApprovalRules: z.array(AutoApprovalRuleSchema).default([]),
  quietHours: QuietHoursSchema.default({ enabled: false }),
  auditLog: AuditLogSchema.default({ enabled: true }),
});
```

### Example escalate.config.json with Intelligence Features

```json
{
  "slack": {
    "channelId": "C0123456789"
  },
  "escalationPolicies": {
    "permissionRequest": "always",
    "preToolUse": "conditional",
    "stop": "always",
    "postToolUseFailure": "never"
  },
  "autoApprovalRules": [
    {
      "type": "tool_name",
      "pattern": "^Read$",
      "description": "Auto-approve all Read tool calls"
    },
    {
      "type": "tool_name",
      "pattern": "^Glob$|^Grep$",
      "description": "Auto-approve search tools"
    },
    {
      "type": "file_path",
      "pattern": "**/test/**",
      "description": "Auto-approve writes to test directories"
    },
    {
      "type": "file_path",
      "pattern": "**/*.test.ts",
      "description": "Auto-approve writes to test files"
    }
  ],
  "quietHours": {
    "enabled": true,
    "start": "22:00",
    "end": "07:00",
    "timezone": "America/New_York",
    "criticalEvents": ["PermissionRequest", "Stop"]
  }
}
```

### HTTP Bridge Handler Modification

```typescript
// src/server/http-bridge.ts -- modified POST /escalations handler (conceptual)

// BEFORE: unconditionally create escalation + send Slack
// AFTER: evaluate rules -> audit log -> conditionally escalate

if (req.method === 'POST' && url.pathname === '/escalations') {
  const { event_type, request_json, fallback_action, timeout_seconds } = body;
  const hookInput = JSON.parse(request_json);
  const config = loadedConfig; // loaded at server startup

  // 1. Extract evaluation inputs
  const toolName = hookInput['tool_name'] as string | undefined;
  const filePaths = extractFilePaths(toolName, hookInput['tool_input'] ?? {});
  const policy = config.escalationPolicies[event_type] ?? 'always';

  // 2. Evaluate auto-approval rules
  const ruleResult = evaluateRules(
    { eventType: event_type, toolName, filePaths },
    config.autoApprovalRules,
    policy,
  );

  // 3. Check quiet hours
  let finalDecision = ruleResult.decision;
  if (finalDecision === 'escalate' && isQuietHours(config.quietHours)) {
    if (!isCriticalEvent(event_type, config.quietHours.criticalEvents)) {
      finalDecision = 'quiet_hours_suppress';
    }
  }

  // 4. Audit log (ALWAYS, regardless of decision)
  appendAuditEntry(auditLogPath, {
    timestamp: new Date().toISOString(),
    eventType: event_type,
    toolName,
    filePaths,
    decision: finalDecision,
    reason: ruleResult.reason,
    matchedRule: ruleResult.matchedRule?.description,
  });

  // 5. Act on decision
  if (finalDecision === 'auto_approve' || finalDecision === 'quiet_hours_suppress') {
    // Short-circuit: create pre-resolved record, return immediately
    const record = store.create({ ... });
    const autoResponse = JSON.stringify({ type: 'action', actionId: 'approve' });
    store.resolve(record.id, autoResponse);
    sendJson(res, 201, { escalation_id: record.id, status: 'resolved' });
    return;
  }

  // 6. Escalate to Slack (existing flow)
  const record = store.create({ ... });
  if (adapter?.isConnected()) {
    void adapter.sendEscalation(escalationRequest).catch(...);
  }
  sendJson(res, 201, { escalation_id: record.id, status: 'pending' });
}
```

### Glob-to-Regex Converter

```typescript
// src/intelligence/rules.ts

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: * (any non-/ chars), ** (any chars including /), ? (single char)
 * Does NOT support: brace expansion {a,b}, negation !, extglob
 */
export function globToRegex(glob: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      // ** matches everything including /
      regex += '.*';
      i += 2;
      // Skip optional trailing /
      if (glob[i] === '/') i++;
    } else if (char === '*') {
      // * matches everything except /
      regex += '[^/]*';
      i++;
    } else if (char === '?') {
      regex += '[^/]';
      i++;
    } else if (char === '.') {
      regex += '\\.';
      i++;
    } else {
      regex += char;
      i++;
    }
  }
  return new RegExp(regex);
}
```

### hooks.json with TaskCompleted

```json
{
  "description": "Escalate plugin hooks - routes Claude Code events to Slack for human decisions",
  "hooks": {
    "PermissionRequest": [ ... ],
    "PreToolUse": [ ... ],
    "Stop": [ ... ],
    "PostToolUseFailure": [ ... ],
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/scripts/on-task-completed.js",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ]
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| External timezone libraries (moment-timezone, luxon) | `Intl.DateTimeFormat` with `timeZone` option (Node.js built-in) | Node.js 13+ (stable since Node 16) | No external dependency for timezone-aware time checks |
| JSON log files (single JSON array) | JSONL (one JSON object per line) | Industry standard for append-only logs | JSONL is append-safe (no array close bracket), streamable, and each line is independently parseable |
| glob matching with minimatch | Simple glob-to-regex for limited patterns | When patterns are simple enough | Avoids dependency for `*`, `**`, `?` only. Use minimatch if negation or braces are needed |

**Deprecated/outdated:**
- `moment-timezone`: deprecated since 2020. Use Intl API or `date-fns-tz` instead
- Log4js / Winston for audit logging: overkill for append-only JSONL. `fs.appendFileSync` is sufficient for single-process logging

## Open Questions

1. **Session Boundary for Audit Log**
   - What we know: The audit log file path is based on `CLAUDE_PROJECT_DIR`. Each session appends to the same file.
   - What's unclear: Should the audit log be per-session (cleared on SessionStart) or cumulative across sessions? Per-session simplifies summary generation. Cumulative provides full history.
   - Recommendation: Per-session. On SessionStart, rename the existing log to `escalate-audit-{timestamp}.jsonl` for archival. The active log is always `escalate-audit.jsonl`. Summaries read only the active log.

2. **Session Summary Trigger: TaskCompleted vs Stop**
   - What we know: The requirement says "TaskCompleted or Stop." TaskCompleted fires when any task is marked complete, which can happen many times per session. Stop fires when Claude finishes responding.
   - What's unclear: Should a summary be sent on every TaskCompleted, or only on significant completions? Sending on every TaskCompleted could be noisy.
   - Recommendation: Send summary on Stop only (once per session end). For TaskCompleted, send a lightweight notification (task name + result) rather than a full summary. The full summary is the end-of-session report.

3. **Auto-Approve Effect on Hook Scripts**
   - What we know: When the HTTP bridge auto-approves, it creates a pre-resolved escalation record. The hook script's `pollForResponse()` will immediately get a resolved record.
   - What's unclear: Should the hook script know it was auto-approved vs user-approved? Currently the response JSON is the same.
   - Recommendation: The auto-approve response should be identical to a user approve: `{ type: 'action', actionId: 'approve' }`. The hook script does not need to distinguish. The audit log records the difference.

4. **Config Hot-Reload**
   - What we know: The config is loaded once at server startup. If the user edits `escalate.config.json` mid-session, the changes are not picked up.
   - What's unclear: Should the intelligence layer re-read config on every request, or cache it?
   - Recommendation: Re-read config on every `POST /escalations` request. The config file is small (~1KB). `readFileSync` + Zod parse is fast enough for a per-request operation. This gives users the ability to tune rules mid-session without restarting.

5. **Quiet Hours Fallback Behavior for Suppressed Events**
   - What we know: During quiet hours, non-critical events should be "auto-handled per fallback policy." The existing `fallbackActions` config has per-event-type fallbacks (allow, deny, ask-again).
   - What's unclear: Should `ask-again` be treated as `allow` during quiet hours (since we can't ask)?
   - Recommendation: During quiet hours, `ask-again` maps to `allow`. The user is not available, so the safest "don't block Claude" default is to allow and log it.

## Sources

### Primary (HIGH confidence)
- Official Claude Code hooks documentation: https://code.claude.com/docs/en/hooks -- Complete event schemas, especially TaskCompleted input (`task_id`, `task_subject`, `task_description`), Stop input (`stop_hook_active`, `last_assistant_message`), SessionEnd input (`reason`). Confirmed: TaskCompleted does not support matchers. Stop does not support matchers.
- Existing codebase: `src/config/schema.ts` -- Current Zod schema structure with `escalationPolicies` already supporting `always`/`conditional`/`never`. Phase 5 implements the "conditional" path.
- Existing codebase: `src/server/http-bridge.ts` -- Current POST /escalations handler showing exact integration point for intelligence layer. Lines 133-193 are the modification target.
- Existing codebase: `src/state/store.ts` -- EscalationStore API showing `create()` and `resolve()` methods needed for pre-resolved auto-approved records.
- Existing codebase: `scripts/lib/bridge-client.ts` -- `pollForResponse()` function showing that pre-resolved records will be immediately returned to hook scripts.

### Secondary (MEDIUM confidence)
- Node.js `Intl.DateTimeFormat` documentation (MDN): confirms `timeZone` option with IANA timezone names works in Node.js 22. `formatToParts()` returns structured `{type, value}` array. Verified via MDN Web Docs.
- JSONL format specification (jsonlines.org): one JSON value per line, newline-delimited. Industry standard for append-only logs (used by Claude Code's own `transcript.jsonl`).

### Tertiary (LOW confidence)
- None. All research domains are well-covered by primary and secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies. All features use Node.js built-ins and existing libraries (Zod, better-sqlite3).
- Architecture: HIGH -- Intelligence layer integrates into a well-understood HTTP bridge handler. Pure-function design enables comprehensive testing.
- Pitfalls: HIGH -- All identified pitfalls have concrete prevention strategies. The overnight quiet hours and config migration pitfalls are the most critical.
- Config schema: HIGH -- Existing schema already has the escalation policy enum. Extension with new sections follows established patterns.

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable domain -- no external API dependencies, Node.js built-in features)
