# Phase 8: Fix UUID Mismatch in Escalation Loop - Research

**Researched:** 2026-02-19
**Domain:** Internal UUID routing between HTTP bridge, Slack adapter, and store resolution
**Confidence:** HIGH

## Summary

Phase 8 fixes a critical integration bug (INT-01 from the v1.0 audit) where the HTTP bridge and Slack adapter generate independent UUIDs for the same escalation. The store creates a record with UUID-A, but `SlackAdapter.sendEscalation()` generates UUID-B via `randomUUID()`. All Slack interactions (button clicks, thread replies, emoji reactions, voice notes) resolve against UUID-B, which does not exist in the store. Meanwhile, hook scripts poll UUID-A, which stays pending forever and times out.

The fix is entirely internal to the existing codebase -- no new libraries, no architectural changes, no new files. It requires: (1) adding an optional `id` field to the `EscalationRequest` type, (2) passing `record.id` from `http-bridge.ts` into the escalation request, (3) using `request.id` in `SlackAdapter.sendEscalation()` instead of `randomUUID()`, and (4) writing tests that prove the full round-trip works through a single UUID.

**Primary recommendation:** Thread the store record ID through the existing `EscalationRequest` type and use it in the Slack adapter. This is a surgical 4-file change with corresponding test updates -- no new dependencies, patterns, or infrastructure needed.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IPC-04 | User response from Slack routes back to Claude Code -- hook exits 0 (allow) or 2 (deny) with optional JSON payload | Fixed by ensuring button click resolves same UUID the hook script polls |
| HOOK-01 | Plugin intercepts PermissionRequest events via hook script that receives JSON on stdin and returns decision via exit code | Broken by UUID mismatch -- button click on UUID-B never resolves UUID-A in store. Fix enables full round-trip. |
| HOOK-02 | Plugin intercepts PreToolUse events to gate dangerous tool executions | Same UUID mismatch breaks PreToolUse escalation resolution |
| HOOK-03 | Plugin intercepts Stop events to ask user about next steps before session ends | Same UUID mismatch breaks Stop escalation resolution |
| SLCK-06 | User can respond with free-form text in thread and Claude receives it as context | Thread replies use `tsToEscalation` map keyed by message `ts` -- the `ts` is stored against UUID-B not UUID-A, so thread replies never resolve the correct store record |
| MDIA-01 | Voice note interpretation -- download audio from Slack thread, send to Claude API for transcription, normalize to text response | Voice note handler uses `tsToEscalation` map with same UUID-B mismatch |
| MDIA-02 | Emoji reaction responses -- configurable emoji-to-decision mapping | Emoji handler uses `tsToEscalation` map with same UUID-B mismatch |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase modifies existing code only.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:crypto | N/A (built-in) | `randomUUID()` for fallback ID generation | Already used in `adapter.ts` and `store.ts` |

### Supporting

No supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Optional `id` field on `EscalationRequest` | Separate parameter to `sendEscalation(request, id?)` | Violates the established `MessagingAdapter` interface contract. Adding to the request type is less invasive and keeps the interface signature unchanged. |
| Passing ID in request | Having HTTP bridge call `adapter.sendEscalation()` then update the store record | Would require making the adapter return value synchronously available, breaking the fire-and-forget pattern (prior decision [04-01]) |
| Modifying `MessagingAdapter.sendEscalation` signature | Adding `id` parameter | Breaks the platform-agnostic adapter interface for all future adapters. The `id` field on `EscalationRequest` is cleaner -- adapters that don't need it simply ignore it. |

## Architecture Patterns

### Recommended Project Structure

No structural changes. All edits happen in existing files:

```
src/
├── types/
│   └── escalation.ts       # Add optional `id` field to EscalationRequest
├── server/
│   └── http-bridge.ts       # Pass record.id into escalation request
└── slack/
    └── adapter.ts           # Use request.id ?? randomUUID() in sendEscalation
test/
├── slack/
│   ├── adapter.test.ts      # Add round-trip UUID tests
│   └── blocks.test.ts       # No changes needed (blocks already take escalationId param)
└── server/
    └── http-bridge.test.ts  # Add integration test proving UUID flows to adapter
```

### Pattern 1: Optional ID Passthrough

**What:** The `EscalationRequest` type gets an optional `id?: string` field. The HTTP bridge populates it with the store record ID. The Slack adapter uses it instead of generating a new UUID.

**When to use:** When a correlation ID must flow through a fire-and-forget boundary without changing the async contract.

**Example:**

```typescript
// src/types/escalation.ts -- ADD optional id field
export interface EscalationRequest {
  readonly id?: string;  // Store record ID (populated by HTTP bridge)
  readonly title: string;
  readonly question: string;
  readonly urgency: UrgencyLevel;
  readonly context: EscalationContext;
  readonly suggestedActions: readonly SuggestedAction[];
  readonly allowFreeformResponse: boolean;
}

// src/server/http-bridge.ts -- PASS record.id
const escalationRequest: EscalationRequest = {
  id: record.id,  // <-- THE FIX: pass store record ID
  title: `${event_type}: ${toolName ?? 'Unknown'}`,
  question: buildQuestionFromEvent(event_type, hookInput),
  // ...rest unchanged
};

// src/slack/adapter.ts -- USE request.id
async sendEscalation(request: EscalationRequest): Promise<string> {
  const escalationId = request.id ?? randomUUID();  // <-- USE passed ID
  const blocks = buildEscalationBlocks(request, escalationId);
  // ...rest unchanged
}
```

### Pattern 2: Action ID Format

**What:** Slack button `action_id` values follow the format `escalate_{escalationId}_{actionValue}`. The handler in `handlers.ts` parses this by splitting on `_` and taking `parts[1]` as the escalation ID.

**Critical constraint:** UUIDs contain hyphens (`-`) but NOT underscores (`_`), so the `split('_')` parsing works correctly: `parts[0]` = "escalate", `parts[1]` = the full UUID, `parts.slice(2).join('_')` = action value.

**Verification:** `randomUUID()` generates RFC 4122 v4 UUIDs like `550e8400-e29b-41d4-a716-446655440000`. These contain only hex digits and hyphens -- no underscores. The `split('_')` delimiter is safe.

### Anti-Patterns to Avoid

- **Changing the `MessagingAdapter` interface signature:** The `sendEscalation(request: EscalationRequest): Promise<string>` contract must remain unchanged. The optional `id` field on the request type preserves backward compatibility -- adapters that don't care about pre-assigned IDs still generate their own.
- **Making `id` required on `EscalationRequest`:** The type is also used by the MCP server tool `create_escalation` and could be used by external callers. Making it required would break callers that don't have a store record yet.
- **Removing `randomUUID()` fallback in adapter:** Keep the `request.id ?? randomUUID()` pattern so the adapter works standalone without the HTTP bridge (e.g., in unit tests or future direct usage).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom ID format | `crypto.randomUUID()` (already used) | Standard, collision-proof, compatible with `split('_')` parsing |

**Key insight:** There is nothing to hand-roll in this phase. The fix uses existing infrastructure differently, not new infrastructure.

## Common Pitfalls

### Pitfall 1: exactOptionalPropertyTypes Compatibility

**What goes wrong:** TypeScript's `exactOptionalPropertyTypes` (enabled in this project's tsconfig) means `id?: string` requires callers to either omit `id` entirely or pass a `string` -- passing `undefined` explicitly is a type error.
**Why it happens:** The `http-bridge.ts` builds the `EscalationRequest` object and always has `record.id` available (a `string`), so this is not an issue for the bridge. But test helpers that build `EscalationRequest` objects must either include `id` as a string or omit it entirely -- never pass `id: undefined`.
**How to avoid:** In test helper `makeRequest()`, do NOT include `id: undefined` in the default object. Only include `id` when testing the passthrough. Use spread with overrides: `{ ...defaults, ...overrides }`.
**Warning signs:** TypeScript error "Type 'undefined' is not assignable to type 'string'" on the `id` field.

### Pitfall 2: Bidirectional Map Consistency

**What goes wrong:** The `escalationToTs` and `tsToEscalation` maps in `SlackAdapter` must use the same escalation ID for both directions. If `sendEscalation` uses UUID-B but `handleAction` parses UUID-B from the button, the maps are consistent within the adapter but disconnected from the store.
**Why it happens:** The maps are consistent already -- the bug is that the adapter's UUID-B differs from the store's UUID-A. Once `sendEscalation` uses `request.id` (UUID-A), all maps and handlers automatically use UUID-A because they all flow from `escalationId` in `sendEscalation`.
**How to avoid:** The fix is self-healing -- once the single source of truth (the store's UUID) flows into `sendEscalation`, all downstream paths use it.
**Warning signs:** After the fix, if a test still sees `store.resolve(escalationId)` returning `false`, the ID is not flowing through correctly.

### Pitfall 3: Action ID Parsing with Non-UUID IDs

**What goes wrong:** The handler in `handlers.ts` (line 49) splits on `_` and takes `parts[1]` as the escalation ID. If the escalation ID itself contains underscores, the parsing breaks.
**Why it happens:** The current code uses `parts[1]` which captures the text between the first and second underscore.
**How to avoid:** UUIDs from `randomUUID()` contain only hex and hyphens -- no underscores. The store also uses `randomUUID()`. As long as IDs are UUIDs, the parsing is safe. Do NOT change the ID format to include underscores.
**Warning signs:** If anyone changes to a custom ID format with underscores, button clicks will fail silently.

### Pitfall 4: Fire-and-Forget Return Value Ignored

**What goes wrong:** The `http-bridge.ts` line `void adapter.sendEscalation(escalationRequest)` discards the return value (the escalation ID that the adapter returns). After the fix, the adapter returns the same ID that was passed in, so the discarded return value is harmless.
**Why it happens:** Prior decision [04-01] established fire-and-forget pattern -- `sendEscalation` does not block the HTTP response.
**How to avoid:** No action needed. The return value of `sendEscalation` is now redundant (it returns the same ID we passed in), but the interface contract still expects it.

## Code Examples

Verified patterns from the existing codebase:

### Current Broken Flow (Lines Referenced)

```typescript
// src/server/http-bridge.ts:281-306 -- creates record, builds request WITHOUT id
const record = store.create({ ... });
const escalationRequest: EscalationRequest = {
  // NO id field -- this is the bug
  title: `${event_type}: ${toolName ?? 'Unknown'}`,
  question: buildQuestionFromEvent(event_type, hookInput),
  urgency: event_type === 'PostToolUseFailure' ? 'warning' : 'critical',
  context,
  suggestedActions: buildActionsForEvent(event_type),
  allowFreeformResponse: true,
};
void adapter.sendEscalation(escalationRequest);  // fire-and-forget

// src/slack/adapter.ts:391-412 -- generates NEW UUID, ignoring store record ID
async sendEscalation(request: EscalationRequest): Promise<string> {
  const escalationId = randomUUID();  // UUID-B -- disconnected from store's UUID-A
  const blocks = buildEscalationBlocks(request, escalationId);
  // ...
}
```

### Fixed Flow

```typescript
// src/types/escalation.ts -- ADD id field
export interface EscalationRequest {
  readonly id?: string;
  readonly title: string;
  // ...rest unchanged
}

// src/server/http-bridge.ts -- PASS record.id
const escalationRequest: EscalationRequest = {
  id: record.id,
  title: `${event_type}: ${toolName ?? 'Unknown'}`,
  // ...rest unchanged
};

// src/slack/adapter.ts -- USE request.id
async sendEscalation(request: EscalationRequest): Promise<string> {
  const escalationId = request.id ?? randomUUID();
  const blocks = buildEscalationBlocks(request, escalationId);
  // ...rest unchanged -- all maps and handlers use escalationId
}
```

### Round-Trip Test Pattern

```typescript
// test/server/http-bridge.test.ts -- integration test with mock adapter
it('passes store record ID to adapter.sendEscalation', async () => {
  let capturedRequest: EscalationRequest | undefined;
  const mockAdapter: MessagingAdapter = {
    sendEscalation: async (req) => {
      capturedRequest = req;
      return req.id ?? 'fallback';
    },
    waitForResponse: async () => ({ type: 'timeout', respondedAt: new Date() }),
    sendFollowUp: async () => {},
    isConnected: () => true,
  };

  bridgeOptions.adapter = mockAdapter;

  const res = await fetch(`${baseUrl}/escalations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'PermissionRequest',
      request_json: JSON.stringify({ tool_name: 'Bash' }),
    }),
  });

  const body = await res.json() as { escalation_id: string };

  // The adapter received the same ID that was returned to the hook script
  expect(capturedRequest?.id).toBe(body.escalation_id);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Adapter generates own UUID | Adapter uses caller-provided ID | Phase 8 (this fix) | Enables full escalation round-trip |

**Deprecated/outdated:**
- Nothing deprecated in this phase. The `randomUUID()` call stays as a fallback.

## Open Questions

1. **Should the `id` field be added to `EscalationRequest` or passed as a separate parameter?**
   - What we know: Adding to `EscalationRequest` keeps the `MessagingAdapter` interface unchanged. A separate parameter would require changing the interface signature, which would affect all adapter implementations.
   - What's unclear: Nothing -- the `EscalationRequest` approach is clearly better.
   - Recommendation: Add `id?: string` to `EscalationRequest`. This is the approach documented in the v1.0 audit fix recommendation.

2. **Do existing tests need updating for the `id` field?**
   - What we know: `test/slack/blocks.test.ts` passes `escalationId` directly to `buildEscalationBlocks()` -- not affected. `test/slack/adapter.test.ts` tests `sendEscalation` and checks the returned UUID format -- this test should be updated to verify that a provided `id` is used instead of generating a new one.
   - Recommendation: Add new test cases to `adapter.test.ts` that pass `id` in the request and verify it is used. Existing tests without `id` should continue to work (fallback to `randomUUID()`).

3. **Should `http-bridge.test.ts` be extended with adapter integration tests?**
   - What we know: Current tests use no adapter (bridge without Slack). The audit noted this gap: "http-bridge.test.ts tests resolution via store.resolve(created.escalation_id) directly, bypassing the Slack UUID routing path."
   - Recommendation: Add a test with a mock adapter that captures the `EscalationRequest` and verifies `request.id` matches `escalation_id` in the HTTP response. This proves the UUID flows through.

## Sources

### Primary (HIGH confidence)

- Codebase analysis: `src/types/escalation.ts` (EscalationRequest interface -- no `id` field)
- Codebase analysis: `src/server/http-bridge.ts:281-306` (builds request without ID, fire-and-forget)
- Codebase analysis: `src/slack/adapter.ts:391-412` (generates independent UUID via `randomUUID()`)
- Codebase analysis: `src/slack/handlers.ts:45-53` (parses escalation ID from `action_id` format)
- Codebase analysis: `src/state/store.ts:87-101` (store generates UUID via `randomUUID()`)
- Codebase analysis: `.planning/v1.0-MILESTONE-AUDIT.md` (INT-01 gap definition and fix recommendation)

### Secondary (MEDIUM confidence)

- Node.js `crypto.randomUUID()` documentation -- generates RFC 4122 v4 UUIDs (hex + hyphens only, no underscores)

### Tertiary (LOW confidence)

- None. All findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries; only modifying existing code
- Architecture: HIGH - The fix is a 3-line change across 3 files, following the exact recommendation from the v1.0 audit
- Pitfalls: HIGH - All pitfalls identified from direct code analysis of the exact files being changed

**Research date:** 2026-02-19
**Valid until:** Indefinite (internal codebase fix, not dependent on external library versions)
