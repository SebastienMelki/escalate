# Phase 4: Hook Scripts and Escalation Loop - Research

**Researched:** 2026-02-19
**Domain:** Claude Code hook scripts (command type), hook-to-MCP-server HTTP IPC, escalation round-trip
**Confidence:** HIGH

## Summary

Phase 4 connects the existing infrastructure (SQLite state store, HTTP bridge, Slack adapter) into a complete escalation loop by adding four thin hook scripts and a `hooks/hooks.json` manifest. Each hook script reads JSON from stdin, POSTs to the HTTP bridge to create an escalation, polls for resolution, and returns a decision to Claude Code via exit code and stdout JSON.

The official Claude Code hooks documentation (https://code.claude.com/docs/en/hooks) fully specifies the JSON input schemas and output decision formats for all four event types: `PermissionRequest`, `PreToolUse`, `Stop`, and `PostToolUseFailure`. The hook scripts are thin dispatchers (<50 lines each) that delegate all logic to the already-running MCP server via its HTTP bridge on localhost. No new npm dependencies are required.

The two IPC requirements (IPC-04 and IPC-06) are largely already satisfied by existing infrastructure: the Slack adapter's `ack()` call handles the 3-second acknowledgment (IPC-06), and the HTTP bridge + SQLite polling provides the response routing (IPC-04). Phase 4 must wire the final exit-code translation: `store.resolve()` response -> hook interprets response JSON -> `exit 0` (allow) or `exit 2` (deny).

**Primary recommendation:** Write four Node.js hook scripts in `scripts/` that use `fetch()` (built-in Node 22) to communicate with the HTTP bridge. Each script follows an identical pattern: read stdin, POST escalation, poll for response, translate to exit code. Bundle them via tsup alongside the existing server entry points.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HOOK-01 | Plugin intercepts PermissionRequest events via hook script that receives JSON on stdin and returns decision via exit code | Official docs confirm PermissionRequest input schema (tool_name, tool_input, permission_suggestions) and output format (hookSpecificOutput.decision.behavior: allow/deny). Hook script reads stdin, POSTs to HTTP bridge, polls for response, returns hookSpecificOutput JSON on stdout with exit 0, or denies via exit 2 |
| HOOK-02 | Plugin intercepts PreToolUse events to gate dangerous tool executions | Official docs confirm PreToolUse input schema (tool_name, tool_input, tool_use_id) and output format (hookSpecificOutput.permissionDecision: allow/deny/ask). Same pattern as HOOK-01 but with different hookSpecificOutput fields |
| HOOK-03 | Plugin intercepts Stop events to ask user about next steps before session ends | Official docs confirm Stop input schema (stop_hook_active, last_assistant_message) and output format (decision: block, reason: string). Script blocks the stop, sends Slack message, waits for response, then either allows stop (exit 0) or blocks with reason (decision: block JSON) |
| HOOK-04 | Plugin intercepts PostToolUseFailure events to notify user of failures requiring attention | Official docs confirm PostToolUseFailure input schema (tool_name, tool_input, error, is_interrupt) and output format (additionalContext). This is fire-and-forget notification -- script POSTs to HTTP bridge, does NOT poll for response, exits 0 immediately |
| HOOK-05 | Hook scripts are thin dispatchers (<50 lines) that delegate all logic to MCP server via HTTP | All scripts use identical pattern: read stdin JSON, extract fields, POST to HTTP bridge, poll GET for response, translate to exit code. Under 50 lines each. No business logic in scripts |
| IPC-04 | User response from Slack routes back to Claude Code -- hook exits 0 (allow) or 2 (deny) with optional JSON payload | Existing: Slack handler calls store.resolve(). Hook script polls GET /escalations/:id and checks status field. When resolved, parses response_json to determine allow/deny. When timed_out, uses fallback_action |
| IPC-06 | Slack interactive payloads acknowledged within 3 seconds independently of hook timeout | Already implemented in Phase 3: `registerActionHandler` calls `await ack()` as its first line before any processing. The 3-second ack is architecturally independent of the hook script's polling loop. No new code needed for this requirement |
</phase_requirements>

## Standard Stack

### Core

No new libraries are needed. Phase 4 uses only what is already installed.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fetch()` | Node 22+ | HTTP requests from hook scripts to HTTP bridge | Zero dependencies; Node 22 has global fetch. Avoids adding axios/node-fetch for 3 HTTP calls |
| Node.js built-in `fs`, `path` | Node 22+ | Read port file for HTTP bridge discovery | Already used throughout codebase |
| Node.js built-in `process.stdin` | Node 22+ | Read hook event JSON from stdin | Standard hook script pattern per official docs |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsup | ^8.5.1 (existing) | Bundle hook scripts as standalone ESM entry points | Must add hook script entry points to tsup config |
| vitest | ^4.0.18 (existing) | Unit test hook script logic | Test the core dispatch function, mock fetch |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node.js scripts | Bash scripts with `curl` + `jq` | Bash is simpler but: (1) jq may not be installed everywhere, (2) harder to test, (3) ESM bundling story is cleaner with Node, (4) TypeScript type safety lost |
| `fetch()` (built-in) | `http.request` (built-in) | `fetch()` is simpler and promise-based. `http.request` is callback-based and more verbose. Both work, fetch is cleaner |
| Individual script files | Single shared dispatcher | A shared dispatcher module reduces duplication but the 50-line limit per script is easy to hit with the simple pattern. Use a shared `lib/` helper for common logic (port file reading, polling loop) |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended File Structure

```
escalate/
├── hooks/
│   └── hooks.json               # Plugin hook manifest (wrapper format)
├── scripts/
│   ├── on-permission-request.ts  # PermissionRequest hook dispatcher
│   ├── on-pre-tool-use.ts        # PreToolUse hook dispatcher
│   ├── on-stop.ts                # Stop hook dispatcher
│   ├── on-post-tool-failure.ts   # PostToolUseFailure hook dispatcher
│   └── lib/
│       └── bridge-client.ts      # Shared HTTP bridge client (port discovery, POST, poll)
├── src/
│   └── ...                       # Existing source (unchanged)
├── tsup.config.ts                # Add hook script entry points
└── dist/
    ├── server/                   # Existing server bundle
    └── scripts/                  # Bundled hook scripts
        ├── on-permission-request.js
        ├── on-pre-tool-use.js
        ├── on-stop.js
        ├── on-post-tool-failure.js
        └── lib/
            └── bridge-client.js
```

### Pattern 1: Thin Hook Dispatcher

**What:** Every hook script follows the same 5-step pattern: (1) read stdin, (2) discover HTTP bridge port, (3) POST escalation, (4) poll for response, (5) translate to exit code + stdout JSON.

**When to use:** Every hook script. No exceptions.

**Source:** Official Claude Code hooks documentation (https://code.claude.com/docs/en/hooks) + Architecture research Pattern 1

**Example (PermissionRequest):**

```typescript
#!/usr/bin/env node
// scripts/on-permission-request.ts
import { readFileSync } from 'node:fs';
import { createEscalation, pollForResponse, readPort } from './lib/bridge-client.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
  const port = readPort();

  // Create escalation via HTTP bridge
  const escalation = await createEscalation(port, {
    event_type: 'PermissionRequest',
    request_json: JSON.stringify(input),
    fallback_action: 'deny',
    timeout_seconds: 600,
  });

  // Poll for user response
  const result = await pollForResponse(port, escalation.escalation_id);

  // Translate response to Claude Code decision
  if (result.status === 'resolved') {
    const response = JSON.parse(result.responseJson);
    if (response.type === 'action' && response.actionId === 'approve') {
      // Allow: exit 0 with hookSpecificOutput
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'allow' },
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }
  }

  // Deny: exit 0 with deny decision (preferred over exit 2 for structured output)
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: 'Permission denied by user via Escalate',
      },
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main().catch(() => process.exit(0)); // Never block Claude on script errors
```

### Pattern 2: Shared Bridge Client

**What:** A shared module that handles port file discovery, HTTP POST to create escalations, and polling GET for responses. All four hook scripts import this module.

**When to use:** Always. This is the core of HOOK-05 -- keeping scripts thin by extracting shared logic.

**Source:** Existing HTTP bridge routes (GET /health, POST /escalations, GET /escalations/:id) in `src/server/http-bridge.ts`

**Example:**

```typescript
// scripts/lib/bridge-client.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const POLL_INTERVAL_MS = 2000;

/** Read the HTTP bridge port from the port file. */
export function readPort(): number {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const portFile = join(projectDir, '.claude', 'escalate-port');
  const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
  if (isNaN(port)) throw new Error(`Invalid port in ${portFile}`);
  return port;
}

/** POST to /escalations to create a pending escalation. */
export async function createEscalation(
  port: number,
  params: {
    event_type: string;
    request_json: string;
    fallback_action: string;
    timeout_seconds: number;
  },
): Promise<{ escalation_id: string; status: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/escalations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await res.json()) as { escalation_id: string; status: string };
}

/** Poll GET /escalations/:id until resolved or timed_out. */
export async function pollForResponse(
  port: number,
  escalationId: string,
  timeoutMs?: number,
): Promise<EscalationResult> {
  const deadline = Date.now() + (timeoutMs ?? 600_000);
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${port}/escalations/${escalationId}`);
    const record = (await res.json()) as EscalationResult;
    if (record.status !== 'pending') return record;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { status: 'timed_out', fallbackAction: 'deny' } as EscalationResult;
}

interface EscalationResult {
  status: string;
  responseJson?: string | null;
  fallbackAction?: string;
  [key: string]: unknown;
}
```

### Pattern 3: Event-Specific Output Translation

**What:** Each hook event has a different output format for allowing/denying. The translation from Slack response to Claude Code output is event-specific.

**When to use:** In the response-handling section of each hook script.

**Source:** Official Claude Code hooks reference (https://code.claude.com/docs/en/hooks)

| Event | Allow | Deny |
|-------|-------|------|
| PermissionRequest | `hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } }` | `hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "..." } }` |
| PreToolUse | `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" }` | `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "..." }` |
| Stop | `exit 0` (no output = allow stop) | `{ decision: "block", reason: "..." }` on stdout |
| PostToolUseFailure | `exit 0` (fire-and-forget notification) | N/A (cannot block -- tool already failed) |

### Pattern 4: Fire-and-Forget Notification (PostToolUseFailure)

**What:** PostToolUseFailure cannot block the tool (it already failed). The hook script sends a notification to Slack via the HTTP bridge but does NOT poll for a response. It exits 0 immediately.

**When to use:** PostToolUseFailure hook only.

**Source:** Official docs: "PostToolUseFailure: No, Shows stderr to Claude (tool already failed)"

**Example:**

```typescript
// scripts/on-post-tool-failure.ts -- simplified pattern
const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const port = readPort();

// Fire notification (no polling needed)
await createEscalation(port, {
  event_type: 'PostToolUseFailure',
  request_json: JSON.stringify(input),
  fallback_action: 'allow', // Cannot block, so fallback is always allow
  timeout_seconds: 60,
});

process.exit(0); // Always allow -- notification only
```

### Anti-Patterns to Avoid

- **Business logic in hook scripts:** Hook scripts must NOT contain escalation rules, Slack calls, or decision logic. They are pure dispatchers to the HTTP bridge.
- **`console.log()` in hook scripts:** Stdout is owned by Claude Code for JSON output. Use `console.error()` (stderr) for debug logging. Any stray stdout text corrupts JSON parsing.
- **Importing from `src/`:** Hook scripts should NOT import from the main `src/` tree. They communicate with the MCP server exclusively via HTTP. This maintains the process boundary.
- **Blocking on errors:** If the HTTP bridge is unreachable or any error occurs, the hook script MUST `process.exit(0)` (allow). Never block Claude on infrastructure failures. The catch-all at the bottom of `main()` ensures this.
- **Using exit 2 for structured denials:** For PermissionRequest and PreToolUse, prefer exit 0 with structured JSON (`hookSpecificOutput`) over exit 2. Exit 2 ignores stdout JSON. Use exit 0 + JSON for richer denial reasons.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for hook->bridge | Custom http.request wrapper | Built-in `fetch()` (Node 22+) | fetch is promise-based, handles JSON, no dependencies |
| Port discovery | Custom IPC mechanism | Read `.claude/escalate-port` file | Already written by server in Phase 2. Synchronous read, one line |
| Timeout/polling loop | Custom event emitter | Simple while loop with setTimeout | Polling is the correct pattern here -- the hook must block synchronously |
| Hook JSON schema validation | Zod schema for stdin JSON | Trust the JSON structure from Claude Code | Claude Code sends well-formed JSON. Adding validation adds lines and risk of false rejections |
| Slack message formatting in hooks | Block Kit in hook scripts | HTTP bridge -> MCP server -> Slack adapter | The whole point of HOOK-05 is that hooks delegate to the MCP server |

**Key insight:** The hook scripts are the thinnest possible layer. Every temptation to add logic to them should be resisted in favor of adding it to the MCP server or Slack adapter.

## Common Pitfalls

### Pitfall 1: stdout Pollution in Hook Scripts

**What goes wrong:** Any text on stdout that is not valid JSON causes Claude Code to fail parsing the hook response. This includes shell profile echoes, Node.js warnings, and accidental `console.log()` calls.
**Why it happens:** Hook scripts are Node.js processes. Some environments print warnings to stdout on startup.
**How to avoid:** (1) Never use `console.log()` -- only `console.error()`. (2) Use `process.stdout.write(JSON.stringify(...))` for structured output, not `console.log`. (3) Test with `echo '{}' | node dist/scripts/on-permission-request.js` and verify only JSON appears on stdout.
**Warning signs:** "JSON validation failed" in Claude Code debug output. Hook decisions silently ignored.

### Pitfall 2: Hook Script Blocks Indefinitely

**What goes wrong:** The HTTP bridge is not running (server crashed, port file stale), and the hook script's fetch call hangs or retries forever.
**Why it happens:** The hook script starts before the MCP server, or the server crashed mid-session.
**How to avoid:** (1) Add a timeout to fetch calls (AbortSignal.timeout). (2) Wrap entire main() in try/catch that exits 0 on any error. (3) The polling loop has a deadline based on the configured timeout.
**Warning signs:** Claude Code appears frozen. No Slack message appears. Hook timeout fires after 600s.

### Pitfall 3: Port File Race Condition

**What goes wrong:** Hook script reads the port file before the MCP server has written it.
**Why it happens:** SessionStart hook fires before the MCP server has finished starting.
**How to avoid:** The port file is written synchronously before `server.listen()` resolves (Phase 2 decision). Additionally, PermissionRequest/PreToolUse hooks fire during the agentic loop, well after session start. The only risk is a SessionStart hook -- but we don't register one in this phase.
**Warning signs:** "ENOENT: no such file" error reading port file.

### Pitfall 4: Stop Hook Infinite Loop

**What goes wrong:** The Stop hook always blocks, causing Claude to continue indefinitely.
**Why it happens:** The hook sends a Slack message asking about next steps, but the response is always interpreted as "continue."
**How to avoid:** (1) Check `stop_hook_active` in the Stop input. If true, this is already a re-stop after a previous block. Consider allowing the stop. (2) Implement a maximum block count using a temp file counter. (3) On timeout, allow the stop (fallback_action: 'ask-again' for stop events means the user gets one more chance, but eventually the timeout resolves to allow).
**Warning signs:** Claude Code runs indefinitely. Slack gets repeated "Should I stop?" messages.

### Pitfall 5: Slack ack() Timeout vs Hook Timeout Confusion

**What goes wrong:** Developer thinks the 3-second ack requirement means the hook must respond in 3 seconds.
**Why it happens:** Conflating two different timeouts: Slack's 3-second ack for interactive payloads and Claude Code's 600-second hook timeout.
**How to avoid:** These are completely independent. The Slack ack() happens in the Slack adapter's action handler (Phase 3, already implemented). The hook script's polling loop runs for up to 600 seconds. They never interact.
**Warning signs:** Unnecessary complexity in hook scripts trying to "ack fast."

### Pitfall 6: Wrong Exit Code for Wrong Event

**What goes wrong:** Using exit 2 for PostToolUseFailure thinking it will block something, but it cannot block (tool already failed). Or using a top-level `decision: "block"` for PreToolUse instead of `hookSpecificOutput.permissionDecision: "deny"`.
**Why it happens:** Different events have different decision formats. Easy to mix up.
**How to avoid:** Strict per-event output format. Reference the decision control table in Pattern 3 above. Test each hook script with sample input JSON.
**Warning signs:** Claude ignores the hook's decision. Unexpected behavior in permission dialogs.

## Code Examples

### hooks/hooks.json - Plugin Hook Manifest

```json
{
  "description": "Escalate plugin hooks - routes Claude Code events to Slack for human decisions",
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/scripts/on-permission-request.js",
            "timeout": 600
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/scripts/on-pre-tool-use.js",
            "timeout": 300
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/scripts/on-stop.js",
            "timeout": 600
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/scripts/on-post-tool-failure.js",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ]
  }
}
```

**Source:** Plugin hooks.json format from official docs (https://code.claude.com/docs/en/hooks#hook-locations) + hookify and ralph-loop examples

**Key decisions in this manifest:**
- PermissionRequest: no matcher (all permission requests are escalated). 600s timeout.
- PreToolUse: matcher "Bash|Write|Edit" gates only dangerous tools. 300s timeout (shorter).
- Stop: no matcher (Stop does not support matchers -- fires on every occurrence). 600s timeout.
- PostToolUseFailure: no matcher. `async: true` makes it non-blocking (fire-and-forget). 30s timeout.

### PermissionRequest Input (from official docs)

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/.../my-project",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf node_modules",
    "description": "Remove node_modules directory"
  },
  "permission_suggestions": [
    { "type": "toolAlwaysAllow", "tool": "Bash" }
  ]
}
```

### PermissionRequest Output (allow)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

### PermissionRequest Output (deny)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Permission denied by user via Escalate"
    }
  }
}
```

### PreToolUse Output (deny)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Dangerous tool blocked by Escalate - user denied via Slack"
  }
}
```

### Stop Output (block)

```json
{
  "decision": "block",
  "reason": "User wants to continue: please implement the remaining tests"
}
```

### Stop Output (allow)

Exit 0 with no output, or:

```json
{}
```

### PostToolUseFailure Output

Exit 0 with no output (fire-and-forget). Optionally:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUseFailure",
    "additionalContext": "User has been notified of this failure via Slack"
  }
}
```

### tsup.config.ts Updates

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/server/index.ts',
    'scripts/on-permission-request.ts',
    'scripts/on-pre-tool-use.ts',
    'scripts/on-stop.ts',
    'scripts/on-post-tool-failure.ts',
    'scripts/lib/bridge-client.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  external: ['better-sqlite3', '@slack/bolt'],
});
```

**Source:** Existing tsup.config.ts in codebase. New entry points for hook scripts placed under `scripts/` to keep them separate from `src/`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Top-level `decision`/`reason` for PreToolUse | `hookSpecificOutput.permissionDecision` | Claude Code hooks reference (current) | Old format deprecated. Must use `hookSpecificOutput` with `hookEventName` field |
| Only exit code signaling | Exit 0 + JSON for structured decisions | Claude Code hooks reference (current) | JSON output only processed on exit 0. Exit 2 ignores stdout JSON entirely |
| Sync-only hooks | `async: true` for non-blocking hooks | Claude Code hooks reference (current) | PostToolUseFailure should use async for fire-and-forget notifications |

**Deprecated/outdated:**
- PreToolUse: `decision: "approve"` and `decision: "block"` are deprecated. Use `hookSpecificOutput.permissionDecision: "allow"/"deny"` instead
- Exit 2 for structured denials: Use exit 0 + JSON instead. Exit 2 is for simple blocking only (stderr message)

## Open Questions

1. **PreToolUse Matcher Scope**
   - What we know: The matcher "Bash|Write|Edit" covers the most dangerous tools. All other tools (Read, Glob, Grep) can execute without escalation.
   - What's unclear: Should MCP tool calls (`mcp__.*`) be included in the matcher? This depends on which MCP servers are configured.
   - Recommendation: Start with "Bash|Write|Edit" for v1. Phase 5 (CFG-02) adds configurable per-event policies that will handle this.

2. **Stop Hook Re-entry Guard**
   - What we know: The Stop input has `stop_hook_active: true` when Claude is stopping after a previous hook block. We must check this to prevent infinite loops.
   - What's unclear: Should we allow exactly one block (and allow on second stop), or should we implement a counter for N blocks?
   - Recommendation: Allow one block maximum. If `stop_hook_active` is true, allow the stop. Simple and safe.

3. **Hook Script Bundling Strategy**
   - What we know: tsup bundles to ESM. Hook scripts need to be standalone executables that run with `node dist/scripts/on-*.js`.
   - What's unclear: Whether tsup will properly tree-shake the shared `bridge-client.ts` into each hook script, or whether each script should be a fully self-contained bundle.
   - Recommendation: Add all hook scripts as separate entry points in tsup. tsup's code splitting will create a shared chunk for bridge-client automatically (as it already does with `chunk-BDEWOLBU.js` for the existing entries). Test that `node dist/scripts/on-permission-request.js` works standalone after build.

4. **PostToolUseFailure: Async vs Sync**
   - What we know: PostToolUseFailure cannot block (tool already failed). Making it `async: true` in hooks.json means it runs in the background and does not block Claude.
   - What's unclear: Whether we should still poll for a user response to a failure notification (so the user can provide guidance that Claude sees on the next turn), or just fire-and-forget.
   - Recommendation: Use `async: true` and fire-and-forget for v1. The notification informs the user. If they want to provide guidance, they can do so via the regular Claude Code prompt. Phase 5 (INTL-05 session summaries) will aggregate these.

5. **HTTP Bridge: sendEscalation Integration**
   - What we know: The HTTP bridge currently has POST /escalations which creates a record in SQLite. But the Slack adapter's `sendEscalation()` is called from the server process, not triggered by the HTTP bridge.
   - What's unclear: How does creating an escalation via HTTP bridge trigger the Slack message? Currently, the bridge just writes to SQLite -- it does not call `slackAdapter.sendEscalation()`.
   - Recommendation: This is the **key integration gap**. The HTTP bridge POST handler (or a new route) must trigger the Slack adapter to send a message. Options: (a) The bridge handler calls `slackAdapter.sendEscalation()` directly since they share the same process, (b) A new route like `POST /escalations/send` that creates the SQLite record AND sends the Slack message, (c) A polling loop in the server that watches for new pending escalations. Option (a) is simplest -- pass the SlackAdapter instance to `createHttpBridge()`.

## Sources

### Primary (HIGH confidence)
- Official Claude Code hooks documentation: https://code.claude.com/docs/en/hooks -- Complete JSON input schemas, output formats, exit code behavior, matcher patterns, async hooks, and decision control for all events
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/SKILL.md` -- Hook types, plugin hooks.json wrapper format, event summary, best practices
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/hooks/stop-hook.sh` -- Real-world Stop hook example: reads stdin JSON, parses transcript_path, returns decision JSON with jq
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/hooks/hooks.json` -- Real-world plugin hooks.json with PreToolUse, PostToolUse, Stop, UserPromptSubmit entries

### Secondary (MEDIUM confidence)
- Existing codebase: `src/server/http-bridge.ts` -- HTTP bridge routes (POST /escalations, GET /escalations/:id, GET /health)
- Existing codebase: `src/server/index.ts` -- Server entrypoint showing port file writing and Slack adapter integration
- Existing codebase: `src/slack/handlers.ts` -- ack() immediately pattern for IPC-06 compliance
- `.planning/research/ARCHITECTURE.md` -- Architecture patterns including "Hook Script as Thin Dispatcher" and data flow diagrams

### Tertiary (LOW confidence)
- GitHub issue #11891 (anthropics/claude-code): "[DOCS] Missing PermissionRequest hook details" -- confirmed that PermissionRequest input includes `tool_name`, `tool_input`, and `permission_suggestions`. This gap has since been closed in the official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies. Official docs fully specify the formats.
- Architecture: HIGH -- Pattern is well-established (thin dispatchers + HTTP bridge) with real-world examples (hookify, ralph-loop).
- Pitfalls: HIGH -- All critical pitfalls are documented with prevention strategies. The stdout corruption and infinite Stop loop are the two most dangerous.
- Integration gap: MEDIUM -- The HTTP bridge -> Slack adapter trigger (Open Question 5) requires a small architectural decision that was not made in prior phases. This is the key design question for the planner.

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable domain -- Claude Code hooks API is versioned and documented)
