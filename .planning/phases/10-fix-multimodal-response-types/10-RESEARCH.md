# Phase 10: Fix Multimodal Response Types in Hook Output - Research

**Researched:** 2026-02-20
**Domain:** Hook script output translation for multimodal response types
**Confidence:** HIGH

## Summary

Phase 10 addresses two broken end-to-end flows discovered during the v1.0 re-audit: emoji reaction approvals (`type:'reaction'`) and voice note approvals (`type:'voice'`) fail in the hook script output path because `scripts/lib/output-helpers.ts` only handles `type:'action'` and `type:'text'`. Both multimodal response types work correctly at the Slack adapter level (Phase 6 verified), and both store the correct data in SQLite via `store.resolve()`. The break occurs when hook scripts poll `GET /escalations/:id`, parse `responseJson`, and the output-helpers functions check `response.type === 'action'` -- neither `'reaction'` nor `'voice'` match, so the default DENY path executes.

This is a narrow, surgical fix affecting primarily one file (`scripts/lib/output-helpers.ts`) and its test file (`test/hooks.test.ts`). There is also an inconsistency in the Slack adapter where `processVoiceNote()` stores `type:'voice'` in SQLite but resolves the in-memory Promise with `type:'text'` -- this should be made consistent.

**Primary recommendation:** Add `type === 'reaction'` handling alongside `type === 'action'` (both carry `actionId`), and add `type === 'voice'` handling alongside `type === 'text'` (both carry `text`), in all output-helper functions. Add comprehensive test coverage for all multimodal response types.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MDIA-01 | Voice note interpretation -- download audio from Slack thread, send to Claude API for transcription, normalize to text response | Voice note download+transcription already works (Phase 6). The gap is in `output-helpers.ts` which ignores `type:'voice'` responses. Fix: treat `type:'voice'` with `text` field identically to `type:'text'` in `buildPermissionRequestOutput`, `buildPreToolUseOutput`, and `buildStopOutput`. |
| MDIA-02 | Emoji reaction responses -- configurable emoji-to-decision mapping (e.g., checkmark = approve, X = deny) | Emoji reaction mapping already works at Slack adapter level (Phase 6). The gap is in `output-helpers.ts` which ignores `type:'reaction'` responses. Fix: treat `type:'reaction'` with `actionId` field identically to `type:'action'` in `buildPermissionRequestOutput` and `buildPreToolUseOutput`. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase modifies existing files only.

| Library | Version | Purpose | Already in Project |
|---------|---------|---------|-------------------|
| vitest | 4.0.18 | Unit testing | Yes |
| typescript | 5.9.3 | Type checking | Yes |
| tsup | 8.5.1 | Bundling | Yes |

### Supporting

None. No new dependencies.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Handling `reaction`/`voice` in output-helpers | Normalizing to `action`/`text` in store.resolve | Would require changing the Slack adapter's store.resolve calls, which are already correct and well-tested. Changes the audit trail semantics (store should reflect what actually happened). Output-helpers is the right layer for this translation. |
| Handling `reaction`/`voice` in output-helpers | Normalizing in http-bridge GET response | Would hide the actual response type from the store record. Same audit trail concern. Output-helpers is closer to the consumer (hook scripts). |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure (Changes)

```
scripts/
└── lib/
    └── output-helpers.ts    # PRIMARY CHANGE: add reaction/voice handling
test/
└── hooks.test.ts            # Add test cases for reaction/voice types
src/
└── slack/
    └── adapter.ts           # CONSISTENCY FIX: store.resolve type:'voice' vs resolver type:'text'
```

### Pattern 1: Unified Response Type Normalization in Output Helpers

**What:** The output-helpers functions translate bridge poll results into Claude Code hook JSON. They must handle all `ResponseType` variants defined in `src/types/escalation.ts`: `'action' | 'text' | 'timeout' | 'voice' | 'reaction'`.

**When to use:** When a resolved escalation's `responseJson` needs to be translated into a hook decision.

**The Fix:**

For `buildPermissionRequestOutput` and `buildPreToolUseOutput`:
- Current: only checks `type === 'action' && actionId === 'approve'`
- Fix: also check `type === 'reaction' && actionId === 'approve'` (reaction carries actionId like action)
- Fix: also handle `type === 'voice'` -- when voice text indicates approval (contains approval keywords or simply route as a decision based on intent analysis)

For `buildStopOutput`:
- Current: checks `type === 'action' && actionId === 'continue'` and `type === 'text'`
- Fix: also check `type === 'reaction' && actionId === 'continue'` (emoji can mean "continue")
- Fix: also check `type === 'voice'` with text (transcribed voice text should route like text)

**Example (PermissionRequest/PreToolUse):**
```typescript
function isApproval(response: ParsedResponse): boolean {
  // Button click or emoji reaction with approve actionId
  if ((response.type === 'action' || response.type === 'reaction') && response.actionId === 'approve') {
    return true;
  }
  return false;
}
```

### Pattern 2: Voice Note Decision Interpretation

**What:** Voice notes produce transcribed text. For PermissionRequest/PreToolUse hooks, the text needs to be interpreted as an approval or denial decision. For Stop hooks, the text provides context (same as thread replies).

**When to use:** When `type === 'voice'` is encountered in output-helpers.

**Design decision -- two approaches:**

1. **Simple: Treat voice like text** -- Voice notes with `actionId` are treated like actions; voice notes with just `text` are treated like text replies. In the Slack adapter, voice notes are already resolved with `{type: 'voice', text: '...'}` (no actionId). For PermissionRequest/PreToolUse, this means voice without explicit actionId defaults to DENY (safe default). For Stop, voice text routes as context (block stop with voice text as reason).

2. **Intent-based: keyword matching** -- Parse transcribed text for approval/denial keywords (e.g., "yes", "approve", "go ahead" = approve; "no", "deny", "stop" = deny). This is fragile and error-prone.

**Recommendation:** Use approach 1 (simple). The Slack adapter already converts voice notes to `{type: 'voice', text: '...'}`. For PermissionRequest/PreToolUse hooks, voice notes without `actionId` should default to DENY (conservative). For Stop hooks, voice text should be treated like thread reply text (block stop with transcribed text as reason). If the user wants to approve via voice, they would typically use the Approve button or an emoji reaction -- voice notes are more naturally suited for providing context/instructions.

**However**, there is a subtlety: the audit trail shows the Slack adapter stores `{type: 'voice', text: '...'}` but the prior decision [06-02] was "Voice note resolver uses type 'text' for downstream pipeline compatibility." The in-memory Promise resolver uses `type: 'text'` (for the `waitForResponse` path), but `store.resolve()` uses `type: 'voice'` (for the polling path). Hook scripts use the polling path, so they see `type: 'voice'`. The fix should handle `type: 'voice'` in output-helpers to match what the store actually contains.

### Pattern 3: Store/Resolver Consistency Fix in Slack Adapter

**What:** `processVoiceNote()` in adapter.ts has a discrepancy:
- Line 280: `store.resolve(escalationId, JSON.stringify({ type: 'voice', text: result.text }))` -- stores `type:'voice'`
- Line 288: `resolver({ type: 'text', text: result.text, respondedAt: new Date() })` -- resolves with `type:'text'`

**Recommendation:** Change the store.resolve call to `type: 'text'` to match the resolver and the [06-02] decision. OR change both to `type: 'voice'` and handle it in output-helpers. Since we ARE adding `type: 'voice'` handling to output-helpers in this phase, the cleanest approach is to keep `type: 'voice'` in the store (preserving audit semantics -- it WAS a voice note) and handle it in output-helpers.

### Anti-Patterns to Avoid

- **Modifying store response semantics:** Do NOT change what the Slack adapter stores in `store.resolve()` just to avoid updating output-helpers. The store should reflect the actual response type for audit trail purposes.
- **Complex text intent parsing:** Do NOT build a keyword-based approval detection system for voice transcriptions. This is fragile and out of scope. Voice text is context, not a parseable decision.
- **Duplicated type checking:** Do NOT copy-paste the same type check logic across all output-helper functions. Extract a shared helper if the pattern repeats.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Response type matching | Complex switch/case per function | Shared helper functions like `isApprovalDecision()` and `hasTextContent()` | DRY, testable, maintainable |
| Voice intent detection | NLP/keyword matching for yes/no from transcribed text | Treat voice text as context (like thread replies) | Fragile, error-prone, out of scope |

**Key insight:** The multimodal response types (`reaction`, `voice`) are semantic variants of the existing types (`action`, `text`). `reaction` is an action with an emoji annotation. `voice` is text with a voice-note origin. The output-helpers should treat them as such.

## Common Pitfalls

### Pitfall 1: Voice Approval Without ActionId

**What goes wrong:** Assuming voice notes carry an `actionId` like reactions do. They do not -- the Slack adapter stores `{type: 'voice', text: '...'}` without any decision mapping.
**Why it happens:** Treating voice notes identically to emoji reactions when the data shapes differ.
**How to avoid:** Check the actual `store.resolve()` call in `adapter.ts` (line 280). Voice notes have `text` but no `actionId`. For PermissionRequest/PreToolUse, this means voice without actionId should default to the DENY path (conservative safe default). For Stop, voice text provides the "block" reason.
**Warning signs:** Tests that check `type === 'voice' && actionId === 'approve'` -- this combination never occurs in practice.

### Pitfall 2: Forgetting the Stop Hook Voice Path

**What goes wrong:** Fixing only PermissionRequest/PreToolUse for voice notes but forgetting that Stop hooks also need to handle voice responses.
**Why it happens:** Focus on the "approval" use case. Stop hooks have different semantics (block/allow stop, not approve/deny permission).
**How to avoid:** Trace all three output-helper functions: `buildPermissionRequestOutput`, `buildPreToolUseOutput`, `buildStopOutput`. Each needs both `reaction` and `voice` handling.
**Warning signs:** Voice note response on Stop hook falls through to "allow stop" (null return) instead of blocking with the transcribed text.

### Pitfall 3: Inconsistent Type Handling Between ParsedResponse and ResponseType

**What goes wrong:** The `ParsedResponse` interface in output-helpers.ts uses `type?: unknown` (loose typing), but `ResponseType` in `escalation.ts` is `'action' | 'text' | 'timeout' | 'voice' | 'reaction'`. If not careful, string comparison may not match.
**Why it happens:** `ParsedResponse` was designed loosely because it parses untrusted JSON from the store.
**How to avoid:** Keep the same pattern: use string literal comparison (`response.type === 'reaction'`). The loose `unknown` type is intentional for safety.
**Warning signs:** Type errors from trying to narrow `ParsedResponse.type` to `ResponseType`.

### Pitfall 4: Emoji Deny Reactions on Stop Hooks

**What goes wrong:** An emoji denial reaction (e.g., X = deny) on a Stop hook should allow the stop (user wants to stop). But if you map it the same as PermissionRequest, `actionId === 'deny'` would mean "deny the stop" = block stop, which is backwards.
**Why it happens:** Stop hook semantics are inverted from PermissionRequest. In PermissionRequest, "deny" means "block the action." In Stop, "deny" could mean "deny the continuation" = allow stop, OR "deny the stop" = block stop.
**How to avoid:** Use the existing action mapping: the Stop hook's buttons are `stop` and `continue`, not `approve` and `deny`. The emoji mapping uses the same actionId values (`approve`/`deny`). For Stop hooks, `actionId === 'continue'` blocks stop; everything else (including `approve` and `deny`) allows stop. This matches the existing button behavior where only `continue` blocks.
**Warning signs:** Emoji reactions producing unexpected stop/continue behavior.

## Code Examples

### Current output-helpers.ts (broken for reaction/voice)

```typescript
// Source: scripts/lib/output-helpers.ts (lines 25-37)
export function buildPermissionRequestOutput(result: EscalationResult): string {
  const response = parseResponse(result);
  if (response && response.type === 'action' && response.actionId === 'approve') {
    // ^ Only checks 'action', misses 'reaction' which also has actionId
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'Permission denied by user via Escalate' },
    },
  });
}
```

### Fixed output-helpers.ts (handles all response types)

```typescript
// Shared helper: checks if the response is an approval decision
function isApprovalDecision(response: ParsedResponse): boolean {
  return (
    (response.type === 'action' || response.type === 'reaction') &&
    response.actionId === 'approve'
  );
}

// Shared helper: checks if the response indicates "continue" for Stop hooks
function isContinueDecision(response: ParsedResponse): boolean {
  return (
    (response.type === 'action' || response.type === 'reaction') &&
    response.actionId === 'continue'
  );
}

// Shared helper: extracts user text from text or voice responses
function extractText(response: ParsedResponse): string | null {
  if ((response.type === 'text' || response.type === 'voice') && typeof response.text === 'string') {
    return response.text;
  }
  return null;
}

export function buildPermissionRequestOutput(result: EscalationResult): string {
  const response = parseResponse(result);
  if (response && isApprovalDecision(response)) {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  }
  // Voice notes without actionId default to deny (conservative)
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'Permission denied by user via Escalate' },
    },
  });
}

export function buildPreToolUseOutput(result: EscalationResult): string {
  const response = parseResponse(result);
  if (response && isApprovalDecision(response)) {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Blocked by user via Escalate',
    },
  });
}

export function buildStopOutput(result: EscalationResult): string | null {
  const response = parseResponse(result);
  if (response) {
    if (isContinueDecision(response)) {
      return JSON.stringify({ decision: 'block', reason: 'User wants to continue via Escalate' });
    }
    const text = extractText(response);
    if (text) {
      return JSON.stringify({ decision: 'block', reason: text });
    }
  }
  return null;
}
```

### Test cases to add

```typescript
// Source: test/hooks.test.ts -- new test cases

// Reaction tests for PermissionRequest
it('returns allow decision when user approves via emoji reaction', () => {
  const result: EscalationResult = {
    status: 'resolved',
    responseJson: JSON.stringify({ type: 'reaction', emoji: 'thumbsup', actionId: 'approve' }),
  };
  const output = JSON.parse(buildPermissionRequestOutput(result));
  expect(output.hookSpecificOutput.decision.behavior).toBe('allow');
});

it('returns deny decision when user denies via emoji reaction', () => {
  const result: EscalationResult = {
    status: 'resolved',
    responseJson: JSON.stringify({ type: 'reaction', emoji: 'x', actionId: 'deny' }),
  };
  const output = JSON.parse(buildPermissionRequestOutput(result));
  expect(output.hookSpecificOutput.decision.behavior).toBe('deny');
});

// Voice tests for PermissionRequest
it('returns deny for voice note without actionId (conservative default)', () => {
  const result: EscalationResult = {
    status: 'resolved',
    responseJson: JSON.stringify({ type: 'voice', text: 'sounds good to me' }),
  };
  const output = JSON.parse(buildPermissionRequestOutput(result));
  expect(output.hookSpecificOutput.decision.behavior).toBe('deny');
});

// Voice tests for Stop
it('returns block decision with transcribed text from voice note', () => {
  const result: EscalationResult = {
    status: 'resolved',
    responseJson: JSON.stringify({ type: 'voice', text: 'keep going, finish the tests' }),
  };
  const raw = buildStopOutput(result);
  expect(raw).not.toBeNull();
  const output = JSON.parse(raw as string);
  expect(output.decision).toBe('block');
  expect(output.reason).toBe('keep going, finish the tests');
});

// Reaction tests for Stop
it('returns block when emoji reaction maps to continue', () => {
  const result: EscalationResult = {
    status: 'resolved',
    responseJson: JSON.stringify({ type: 'reaction', emoji: 'thumbsup', actionId: 'continue' }),
  };
  const raw = buildStopOutput(result);
  expect(raw).not.toBeNull();
  const output = JSON.parse(raw as string);
  expect(output.decision).toBe('block');
});

it('returns null (allow stop) when emoji reaction is not continue', () => {
  const result: EscalationResult = {
    status: 'resolved',
    responseJson: JSON.stringify({ type: 'reaction', emoji: 'x', actionId: 'deny' }),
  };
  expect(buildStopOutput(result)).toBeNull();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Only type:'action' and type:'text' handled | All 5 ResponseType variants handled | Phase 10 (this phase) | Fixes 2 broken E2E flows |

**Deprecated/outdated:**
- None. This phase adds handling for types that already exist in the type system but were missing from the output translation layer.

## Open Questions

1. **Should voice notes on PermissionRequest/PreToolUse be treated as approval?**
   - What we know: Voice notes contain transcribed text, not a structured decision. The Slack adapter stores `{type:'voice', text:'...'}` without an `actionId`.
   - What's unclear: Should "yes, go ahead" in a voice note be interpreted as approval?
   - Recommendation: No. Voice text without actionId defaults to DENY for PermissionRequest/PreToolUse (conservative, safe). Users who want to approve via voice should be educated to use emoji reactions or buttons instead. Voice notes on Stop hooks naturally route as context text (blocking stop with the transcribed instructions). This avoids building fragile NLP logic and matches the safety-first design of Escalate.

2. **Should store.resolve in processVoiceNote be changed from type:'voice' to type:'text'?**
   - What we know: Prior decision [06-02] says "Voice note resolver uses type 'text' for downstream pipeline compatibility." The in-memory resolver does use `type:'text'`, but `store.resolve()` uses `type:'voice'`.
   - What's unclear: Was this intentional (different types for different paths) or a bug?
   - Recommendation: Keep `type:'voice'` in the store for audit trail accuracy (the response WAS a voice note), and handle `type:'voice'` in output-helpers. This preserves the semantic richness of the store records while fixing the downstream behavior. The [06-02] decision was partially implemented (resolver yes, store no) -- output-helpers is the correct normalization layer.

## Sources

### Primary (HIGH confidence)

- **Codebase analysis** (direct file reads, all verified):
  - `scripts/lib/output-helpers.ts` -- the broken file, only handles `type:'action'` and `type:'text'`
  - `src/types/escalation.ts` -- defines `ResponseType = 'action' | 'text' | 'timeout' | 'voice' | 'reaction'`
  - `src/slack/adapter.ts` -- stores `type:'reaction'` (line 198) and `type:'voice'` (line 280) in SQLite
  - `test/hooks.test.ts` -- existing tests only cover `type:'action'` and `type:'text'`
  - `scripts/lib/bridge-client.ts` -- polling mechanism that hook scripts use (returns store record)
  - `src/server/http-bridge.ts` -- GET /escalations/:id returns the raw store record to hook scripts

- **v1.0 Milestone Audit** (`.planning/v1.0-MILESTONE-AUDIT.md`):
  - Confirmed MDIA-01 and MDIA-02 as unsatisfied with detailed root cause analysis
  - Identified the exact gap: output-helpers doesn't handle new response types
  - Audit-recommended fix matches this research

### Secondary (MEDIUM confidence)

- **Prior decisions** (`.planning/STATE.md`):
  - [06-02]: "Voice note resolver uses type 'text' for downstream pipeline compatibility" -- partially implemented (resolver yes, store no)
  - [06-01]: "Conditional spread for exactOptionalPropertyTypes on TranscriptionResult durationMs"
  - [08-01]: "Optional id field on EscalationRequest with request.id ?? randomUUID() fallback"

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all changes in existing files
- Architecture: HIGH -- the fix pattern is clear (add type branches to existing switch logic), verified by reading all relevant source files
- Pitfalls: HIGH -- all identified through direct codebase analysis, not speculation
- Voice note approval semantics: MEDIUM -- conservative default (deny) is safe, but users may expect voice "yes" to approve. This is a UX question, not a technical one.

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable -- internal codebase, no external dependency changes)
