# Phase 12: Fix Session Summary, Snooze, and Message Context - Research

**Researched:** 2026-02-20
**Domain:** Node.js async lifecycle, Slack Block Kit actions, hook script output handling
**Confidence:** HIGH

## Summary

Phase 12 closes the final 3 requirement gaps and 1 flow gap identified by the v1.0 third milestone audit. All four issues are well-understood bugs in existing code, not new feature development. The fixes are surgical: (1) await the async `requestSummary()` call before `process.exit(0)` in two hook scripts, (2) add a Snooze action to `buildActionsForEvent()` and handle the snooze response type in `output-helpers.ts`, (3) pass the already-extracted `filePaths` array into `EscalationRequest.context` in `http-bridge.ts`, and (4) bump the hooks.json PreToolUse timeout from 300s to 320s.

The codebase already has all the plumbing in place -- `EscalationContext.filePaths` is typed, `blocks.ts` renders "Files:" blocks, and the test suite has a Snooze button test (`blocks.test.ts:177`). The work is connecting existing pieces that were wired incorrectly or incompletely.

**Primary recommendation:** Four focused, independent fixes touching 5 files (`on-task-completed.ts`, `on-stop.ts`, `http-bridge.ts`, `output-helpers.ts`, `hooks.json`), each with targeted unit tests.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTL-05 | Session summary DM on TaskCompleted or Stop -- phases completed, decisions made, notable events | `requestSummary()` is async but fire-and-forget with immediate `process.exit(0)`. Fix: convert `on-task-completed.ts` to async, await `requestSummary()`. Same for `on-stop.ts`. |
| SLCK-02 | Messages include interactive Approve/Deny/Snooze buttons for binary and multi-choice decisions | `buildActionsForEvent()` in `http-bridge.ts` only returns Approve+Deny. Fix: add `{ id: 'snooze', label: 'Snooze' }` for PermissionRequest and PreToolUse events. Handle snooze response in `output-helpers.ts`. |
| SLCK-03 | Messages include rich GSD context -- current phase, task name, what Claude was about to do, and why it needs a decision | `filePaths` extracted at `http-bridge.ts:187` but not passed to `EscalationRequest.context` at lines 293-296. Fix: add `filePaths` spread to context object. Already typed in `EscalationContext`, already rendered in `blocks.ts`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | >=22 | Runtime for hook scripts and MCP server | Project requirement (package.json engines) |
| TypeScript | ^5.9 | Type checking with strict mode | Existing project config |
| vitest | ^4.0 | Test runner | Established test pattern across all phases |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @slack/types | ^2.20 | Slack Block Kit type definitions | Already imported in blocks.ts |
| @slack/bolt | ^4.6 | Slack Socket Mode client | Already used in adapter.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `await requestSummary()` | `setTimeout(() => process.exit(0), 500)` | Timeout is fragile -- network latency varies. `await` is deterministic and cleaner. |
| Snooze as "delay" timer | Snooze as "skip and timeout" | Timer-based snooze would require new state management. Treating snooze as "let timeout handle it" is simpler and matches the existing timeout fallback mechanism. |

## Architecture Patterns

### Recommended Project Structure
No new files needed. Changes affect existing files only:
```
scripts/
├── on-task-completed.ts   # Fix: async main, await requestSummary
├── on-stop.ts             # Fix: requestSummary already awaited after escalation resolution, just ensure timing
├── lib/
│   ├── bridge-client.ts   # No changes needed
│   └── output-helpers.ts  # Fix: handle 'snooze' response type
src/
├── server/
│   └── http-bridge.ts     # Fix: add Snooze action, pass filePaths to context
├── types/
│   └── escalation.ts      # Already has filePaths in EscalationContext -- no changes
├── slack/
│   └── blocks.ts          # Already renders filePaths -- no changes
hooks/
└── hooks.json             # Fix: PreToolUse timeout 300 -> 320
```

### Pattern 1: Async Hook Script with Awaited Summary
**What:** Convert synchronous `main()` in `on-task-completed.ts` to async, await `requestSummary()` before exiting.
**When to use:** Any hook script that must complete an async operation before process termination.
**Example:**
```typescript
// CURRENT (broken): on-task-completed.ts
function main(): void {
  const port = readPort();
  void requestSummary(port).catch(() => {});
  process.exit(0);  // kills fetch before TCP handshake
}

// FIXED: on-task-completed.ts
async function main(): Promise<void> {
  const port = readPort();
  await requestSummary(port).catch(() => {});
  process.exit(0);  // exits AFTER summary sends
}

main().catch(() => process.exit(0));
```
**Source:** Node.js docs -- `process.exit()` forces immediate termination, does not drain pending async I/O.

### Pattern 2: Snooze Action as Timeout Delegation
**What:** Snooze button triggers a response type that the hook interprets as "do nothing, let timeout decide." The hook script sees a snooze response and applies the configured fallback action (typically deny for PermissionRequest/PreToolUse).
**When to use:** When the user wants to defer a decision without explicitly approving or denying.
**Example:**
```typescript
// http-bridge.ts: buildActionsForEvent
case 'PermissionRequest':
case 'PreToolUse':
  return [
    { id: 'approve', label: 'Approve', style: 'primary' },
    { id: 'deny', label: 'Deny', style: 'danger' },
    { id: 'snooze', label: 'Snooze' },
  ];

// output-helpers.ts: handle snooze in buildPermissionRequestOutput
function isSnoozeDecision(response: ParsedResponse): boolean {
  return (response.type === 'action' || response.type === 'reaction')
    && response.actionId === 'snooze';
}

// In buildPermissionRequestOutput:
if (response && isSnoozeDecision(response)) {
  // Snooze = deny (conservative). The user deferred the decision.
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'Snoozed by user via Escalate' },
    },
  });
}
```

### Pattern 3: filePaths Context Propagation
**What:** Pass the already-extracted `filePaths` array from the intelligence pipeline into the EscalationRequest context for Slack rendering.
**When to use:** Any data that should appear in the Slack message's context blocks.
**Example:**
```typescript
// CURRENT (broken): http-bridge.ts lines 293-296
const context: EscalationRequest['context'] = {
  eventType: event_type,
  ...(typeof toolName === 'string' ? { toolName } : {}),
};

// FIXED: http-bridge.ts
const context: EscalationRequest['context'] = {
  eventType: event_type,
  ...(typeof toolName === 'string' ? { toolName } : {}),
  ...(filePaths.length > 0 ? { filePaths } : {}),
};
```
**Source:** `EscalationContext.filePaths` is already typed at `escalation.ts:25`, and `blocks.ts:65-75` already renders it.

### Anti-Patterns to Avoid
- **setTimeout for async flush:** Using `setTimeout(() => process.exit(0), 500)` is fragile. Network conditions vary. Use `await` instead.
- **Snooze as timer/delay:** Don't implement a "snooze for 5 minutes" mechanism. That requires new state management and re-notification logic. Snooze = "deny now, user chose to defer."
- **Hardcoding timeout buffer:** Don't hardcode `320` in hooks.json without documenting why. The 20s buffer accounts for the final poll cycle (2s POLL_INTERVAL_MS) plus fetch timeout (10s FETCH_TIMEOUT_MS) plus margin.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Snooze timer mechanism | Delayed re-notification system | Treat snooze as deny with message | Avoids new state, timers, and re-escalation logic |
| Async flush before exit | Custom event loop drain | `await` the promise | Node.js handles this natively |
| File path rendering | Custom Slack block builder | Existing `blocks.ts:65-75` code | Already implemented, tested, just needs data |

**Key insight:** All four fixes connect existing code that already works independently. No new libraries, no new abstractions, no new patterns.

## Common Pitfalls

### Pitfall 1: process.exit() Kills Pending Async I/O
**What goes wrong:** `void requestSummary(port).catch(() => {})` followed by `process.exit(0)` terminates the process before the HTTP request completes.
**Why it happens:** `process.exit()` is synchronous and forceful. It does not wait for the event loop to drain. Fire-and-forget promises are killed.
**How to avoid:** Always `await` async operations that must complete before exit. In `on-task-completed.ts`, this means converting `main()` from sync to async.
**Warning signs:** Summary never appearing in Slack despite audit log showing events.

### Pitfall 2: on-task-completed.ts Does Not Read Stdin
**What goes wrong:** Currently `on-task-completed.ts` does not read stdin. The TaskCompleted hook event provides `task_id`, `task_subject`, `task_description` on stdin. While we don't use these fields, converting to async `main()` does not require reading stdin -- but be aware the comment says "reads stdin" even though the code does not.
**Why it happens:** The original design was fire-and-forget with sync main.
**How to avoid:** When making `main()` async, do not add stdin reading unless needed. The summary endpoint reads from the audit log, not from stdin.
**Warning signs:** Reading stdin in an async context without proper error handling can cause hangs.

### Pitfall 3: Snooze Response Type Leaking Through as "Allow"
**What goes wrong:** If `output-helpers.ts` does not explicitly handle the `snooze` actionId, it falls through to the default deny case. This is actually the correct behavior for PermissionRequest/PreToolUse, but for Stop events, snooze should NOT be offered (Stop only has Stop/Continue).
**Why it happens:** `isApprovalDecision()` checks for `actionId === 'approve'`, so `snooze` already falls through to deny. But developers might mistakenly add snooze to Stop events.
**How to avoid:** Only add Snooze to PermissionRequest and PreToolUse actions. Stop events should remain Stop/Continue only.
**Warning signs:** Snooze button appearing on Stop event messages.

### Pitfall 4: hooks.json Timeout Must Be Strictly Greater Than Poll Timeout
**What goes wrong:** If hooks.json timeout (300s) equals the pollForResponse deadline (300s), Claude Code can kill the hook process while `pollForResponse` is in its final fetch cycle.
**Why it happens:** The hook process timeout is a hard kill from Claude Code. The poll timeout is a soft deadline checked in JavaScript. A fetch request in flight when the process is killed produces no output.
**How to avoid:** hooks.json timeout = config timeout + 20s buffer. The 20s accounts for: FETCH_TIMEOUT_MS (10s) + POLL_INTERVAL_MS (2s) + startup overhead + margin.
**Warning signs:** PreToolUse hook exiting with no output (neither allow nor deny) in production.

### Pitfall 5: on-stop.ts Already Has requestSummary After Await
**What goes wrong:** Developers might think on-stop.ts has the same pattern as on-task-completed.ts and apply the same fix.
**Why it happens:** Both scripts call `void requestSummary(port).catch(() => {})` followed by `process.exit(0)`.
**How to avoid:** In on-stop.ts, `requestSummary` runs AFTER `pollForResponse` completes (line 37). The async main is already awaited. The fix is the same: `await requestSummary(port).catch(() => {})` instead of `void requestSummary(port).catch(() => {})`.
**Warning signs:** Double-fixing or different fix approaches for the same pattern.

## Code Examples

Verified patterns from the existing codebase:

### Fix 1: on-task-completed.ts -- Await Summary Before Exit
```typescript
// Source: scripts/on-task-completed.ts (current lines 10-22)
// BEFORE:
function main(): void {
  const port = readPort();
  void requestSummary(port).catch(() => {});
  process.exit(0);
}
try { main(); } catch { process.exit(0); }

// AFTER:
import { readPort, requestSummary } from './lib/bridge-client.js';

async function main(): Promise<void> {
  const port = readPort();
  await requestSummary(port).catch(() => {});
  process.exit(0);
}
main().catch(() => process.exit(0));
```

### Fix 2: on-stop.ts -- Await Summary Before Exit
```typescript
// Source: scripts/on-stop.ts (current lines 36-39)
// BEFORE:
  void requestSummary(port).catch(() => {});
  process.exit(0);

// AFTER:
  await requestSummary(port).catch(() => {});
  process.exit(0);
```

### Fix 3: buildActionsForEvent -- Add Snooze Button
```typescript
// Source: src/server/http-bridge.ts (current lines 80-101)
// BEFORE:
case 'PermissionRequest':
case 'PreToolUse':
  return [
    { id: 'approve', label: 'Approve', style: 'primary' },
    { id: 'deny', label: 'Deny', style: 'danger' },
  ];

// AFTER:
case 'PermissionRequest':
case 'PreToolUse':
  return [
    { id: 'approve', label: 'Approve', style: 'primary' },
    { id: 'deny', label: 'Deny', style: 'danger' },
    { id: 'snooze', label: 'Snooze' },
  ];
```

### Fix 4: output-helpers.ts -- Handle Snooze Response
```typescript
// Source: scripts/lib/output-helpers.ts
// ADD: snooze detection helper
function isSnoozeDecision(response: ParsedResponse): boolean {
  return (
    (response.type === 'action' || response.type === 'reaction') &&
    response.actionId === 'snooze'
  );
}

// In buildPermissionRequestOutput, BEFORE the default deny:
if (response && isSnoozeDecision(response)) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'Snoozed by user via Escalate' },
    },
  });
}

// In buildPreToolUseOutput, BEFORE the default deny:
if (response && isSnoozeDecision(response)) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Snoozed by user via Escalate',
    },
  });
}
```

### Fix 5: http-bridge.ts -- Pass filePaths to Context
```typescript
// Source: src/server/http-bridge.ts (current lines 293-296)
// BEFORE:
const context: EscalationRequest['context'] = {
  eventType: event_type,
  ...(typeof toolName === 'string' ? { toolName } : {}),
};

// AFTER:
const context: EscalationRequest['context'] = {
  eventType: event_type,
  ...(typeof toolName === 'string' ? { toolName } : {}),
  ...(filePaths.length > 0 ? { filePaths } : {}),
};
```

### Fix 6: hooks.json -- PreToolUse Timeout Buffer
```json
// Source: hooks/hooks.json (current line 20)
// BEFORE:
"timeout": 300

// AFTER:
"timeout": 320
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `void promise.catch(() => {})` + `process.exit(0)` | `await promise.catch(() => {})` + `process.exit(0)` | This phase | Session summary actually sends |
| Approve/Deny only actions | Approve/Deny/Snooze actions | This phase | Users can defer decisions |
| filePaths for rules/audit only | filePaths in Slack context too | This phase | Richer Slack messages |
| hooks.json timeout == poll timeout | hooks.json timeout = poll timeout + 20s | This phase | Prevents mid-poll kill |

**Deprecated/outdated:**
- Nothing deprecated. All changes are additive fixes to existing code.

## Open Questions

1. **Snooze Behavior for Different Event Types**
   - What we know: Snooze on PermissionRequest/PreToolUse should deny (conservative). Stop events should NOT have Snooze (Stop/Continue is the natural binary).
   - What's unclear: Should PostToolUseFailure have Snooze? Currently it only has "Acknowledged."
   - Recommendation: No Snooze for PostToolUseFailure. It is fire-and-forget notification, not a decision point.

2. **on-task-completed.ts TaskCompleted Hook Timeout**
   - What we know: hooks.json sets `"timeout": 30` with `"async": true` for TaskCompleted. The `async: true` flag means Claude Code does not wait for the hook to complete.
   - What's unclear: With `async: true`, does Claude Code still enforce the 30s timeout? If so, `await requestSummary()` must complete within 30s. `FETCH_TIMEOUT_MS` is 10s, so this should be fine.
   - Recommendation: The 30s timeout with `async: true` should be sufficient. The `/summary` endpoint processes locally (audit log read + Slack post). No change needed to the timeout.

3. **on-stop.ts Process Exit After Await**
   - What we know: on-stop.ts is NOT async:true in hooks.json (it has 600s synchronous timeout). After `pollForResponse` resolves and output is written, the summary fires and then `process.exit(0)` runs.
   - What's unclear: Claude Code may have already consumed stdout output. Does the process need to stay alive for anything else after writing output?
   - Recommendation: `await requestSummary()` then `process.exit(0)` is correct. The summary is a fire-and-forget to the bridge, not output to Claude Code.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `scripts/on-task-completed.ts`, `scripts/on-stop.ts` -- direct inspection of the fire-and-forget + process.exit pattern
- Codebase analysis: `src/server/http-bridge.ts:80-101` -- `buildActionsForEvent()` only produces Approve/Deny
- Codebase analysis: `src/server/http-bridge.ts:293-296` -- context object missing filePaths
- Codebase analysis: `hooks/hooks.json` -- PreToolUse timeout = 300s
- Codebase analysis: `src/config/defaults.ts` -- DEFAULT_TIMEOUTS.preToolUse = 300_000ms
- Codebase analysis: `scripts/lib/bridge-client.ts:19` -- POLL_INTERVAL_MS = 2000, FETCH_TIMEOUT_MS = 10_000

### Secondary (MEDIUM confidence)
- Node.js docs: `process.exit()` behavior -- forces immediate termination without draining async I/O (well-established behavior since Node.js v0.1)

### Tertiary (LOW confidence)
- None. All findings verified from codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries
- Architecture: HIGH -- all four fixes are well-understood one-line to five-line changes in existing files
- Pitfalls: HIGH -- root causes documented in the v1.0 audit report with evidence

**Research date:** 2026-02-20
**Valid until:** Indefinite (fixes to specific bugs, not evolving technology)
