# Phase 11: Read Hook Timeouts from Config - Research

**Researched:** 2026-02-20
**Domain:** Hook script configuration, JSON file reading from Node.js scripts, timeout synchronization
**Confidence:** HIGH

## Summary

Phase 11 is a gap-closure phase that addresses IPC-03's partial satisfaction: hook scripts currently hardcode `timeout_seconds` values when creating escalations, and `pollForResponse` uses a hardcoded 600,000ms default. The fix is to have each hook script read `escalate.config.json` at startup, extract its event-type-specific timeout from the `timeouts` section, and pass that value both to `createEscalation()` (for the SQLite timeout_at) and to `pollForResponse()` (for the client-side polling deadline).

The config schema, defaults, and loader already exist in `src/config/`. However, hook scripts currently do NOT import anything from `src/config/` -- they only import from `scripts/lib/bridge-client.ts`. The key design question is whether to: (A) create a lightweight config reader in `scripts/lib/` that duplicates the minimal reading logic (read JSON, extract timeouts, fallback to defaults), or (B) import the full `src/config/loader.ts` into hook scripts. Option B is cleaner because the config loader already handles all edge cases (file not found, invalid JSON, validation failure) and tsup bundles everything into self-contained dist/ files anyway.

**Primary recommendation:** Add a `readConfig()` function to `scripts/lib/bridge-client.ts` that imports `loadConfig` from `src/config/loader.ts` and `DEFAULT_TIMEOUTS` from `src/config/defaults.ts`, then have each hook script call it to get its event-type timeout. Both `timeout_seconds` (sent to bridge) and `pollForResponse` `timeoutMs` must use the config value to stay synchronized.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IPC-03 | Hook scripts poll SQLite for user response with configurable timeout (default 10 minutes for PermissionRequest) | Each hook script reads its timeout from `escalate.config.json` `timeouts` section. Config schema already defines `TimeoutConfigSchema` with per-event defaults (permissionRequest: 600,000ms, preToolUse: 300,000ms, stop: 600,000ms, postToolUseFailure: 60,000ms). Hook scripts need to call `loadConfig()`, extract the relevant timeout, and pass it to both `createEscalation()` and `pollForResponse()`. Fallback to `DEFAULT_TIMEOUTS` when config is missing or invalid. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase uses existing config infrastructure.

| Library | Version | Purpose | Already In Use |
|---------|---------|---------|----------------|
| zod | ^4.3.6 | Config validation (already used by loadConfig) | Yes |

### Supporting

No supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Import `loadConfig` from src/config | Hand-roll JSON.parse in scripts/lib | Duplicates error handling, skips validation, misses future schema changes |
| Read config in each hook script | Read config once in bridge-client helper | Helper is cleaner -- centralizes config reading, DRY |
| Read config from disk in scripts | Ask the HTTP bridge for config values | Over-engineering -- adds a new HTTP endpoint for something that's a single file read |

**Installation:**
```bash
# No new dependencies
```

## Architecture Patterns

### Recommended Project Structure

No new files needed. All edits are in existing files:

```
scripts/
├── lib/
│   └── bridge-client.ts         # Add readTimeoutMs() helper
├── on-permission-request.ts     # Use config timeout instead of hardcoded 600
├── on-pre-tool-use.ts           # Use config timeout instead of hardcoded 300
├── on-stop.ts                   # Use config timeout instead of hardcoded 600
└── on-post-tool-failure.ts      # Use config timeout instead of hardcoded 60

tsup.config.ts                   # No changes needed (bridge-client already an entry)
```

### Pattern 1: Config-Aware Timeout Helper in bridge-client.ts

**What:** A function in `scripts/lib/bridge-client.ts` that reads `escalate.config.json` and returns the timeout for a given event type in milliseconds.

**Why in bridge-client.ts:** This file already handles port discovery (reading from the filesystem with `CLAUDE_PROJECT_DIR` fallback). Adding config reading follows the same pattern -- it is the shared infrastructure for hook scripts.

**Example:**
```typescript
import { loadConfig } from '../../src/config/loader.js';
import { DEFAULT_TIMEOUTS } from '../../src/config/defaults.js';

/** Event type keys matching the timeouts config section. */
type TimeoutEventType = 'permissionRequest' | 'preToolUse' | 'stop' | 'postToolUseFailure';

/**
 * Read the timeout for an event type from escalate.config.json.
 * Returns the value in milliseconds. Falls back to DEFAULT_TIMEOUTS
 * when config is missing, invalid, or the field is absent.
 */
export function readTimeoutMs(eventType: TimeoutEventType): number {
  const result = loadConfig();
  if (result.success) {
    return result.data.timeouts[eventType];
  }
  return DEFAULT_TIMEOUTS[eventType];
}
```

**Key details:**
- `loadConfig()` already handles file-not-found (returns `FILE_NOT_FOUND` error), invalid JSON (`INVALID_JSON`), and schema validation failures (`VALIDATION_FAILED`). All return `success: false`, which triggers the default fallback.
- The `timeouts` section in the schema has `.default()` on every field, so even a config with `"timeouts": {}` will produce valid defaults after Zod parsing.
- Config values are already in milliseconds (DEFAULT_TIMEOUTS uses 600_000, 300_000, etc.), matching what `pollForResponse()` expects.
- `timeout_seconds` sent to the HTTP bridge needs to be converted from ms to seconds: `Math.ceil(timeoutMs / 1000)`.

### Pattern 2: Synchronized Dual Timeouts

**What:** Both `createEscalation()` (server-side SQLite timeout_at) and `pollForResponse()` (client-side polling deadline) must use the same timeout value.

**Current state (hardcoded, misaligned):**

| Hook Script | `timeout_seconds` (bridge) | `pollForResponse` timeoutMs | Aligned? |
|------------|---------------------------|---------------------------|----------|
| on-permission-request.ts | 600 | 600,000 (default) | Yes |
| on-pre-tool-use.ts | 300 | 600,000 (default) | NO -- polls for 10min but bridge times out at 5min |
| on-stop.ts | 600 | 600,000 (default) | Yes |
| on-post-tool-failure.ts | 60 | N/A (no polling) | N/A |

**Important finding:** `on-pre-tool-use.ts` currently has a misalignment -- `timeout_seconds: 300` (5 min) but `pollForResponse` defaults to `600_000` (10 min). The SQLite record will time out at 5 minutes, and the polling will detect this (status changes from 'pending' to 'timed_out'), so it works correctly in practice. But it would be cleaner to align them.

**Fix pattern:**
```typescript
const timeoutMs = readTimeoutMs('permissionRequest');

const esc = await createEscalation(port, {
  event_type: 'PermissionRequest',
  request_json: JSON.stringify(input),
  fallback_action: 'deny',
  timeout_seconds: Math.ceil(timeoutMs / 1000),
});

const result = await pollForResponse(port, esc.escalation_id, timeoutMs);
```

### Pattern 3: Config File Location Resolution

**What:** Hook scripts need to find `escalate.config.json`. The `loadConfig()` function defaults to `resolve(process.cwd(), 'escalate.config.json')`.

**Current behavior in hook scripts:**
- Hook scripts are launched by Claude Code with `cwd` set to the project directory
- `CLAUDE_PROJECT_DIR` env var is set by Claude Code for hook processes (confirmed: `readPort()` in bridge-client.ts already uses this)
- `loadConfig()` uses `process.cwd()` by default, which should be the project directory

**Risk:** If `loadConfig()` is called without an explicit path and `process.cwd()` differs from the project root, the config file will not be found. This is the same risk that `readPort()` mitigates by using `CLAUDE_PROJECT_DIR`. The `loadConfig()` function could optionally accept a custom path.

**Mitigation:** Pass an explicit config path using `CLAUDE_PROJECT_DIR`:
```typescript
import { resolve } from 'node:path';

const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
const configPath = resolve(projectDir, 'escalate.config.json');
const result = loadConfig(configPath);
```

This aligns with the existing `readPort()` pattern and ensures config is found regardless of `cwd`.

### Anti-Patterns to Avoid

- **Reading config on every poll iteration:** Config should be read ONCE at hook script startup, not on every poll cycle. The timeout value does not change during a single escalation.
- **Different units between bridge and poll:** `createEscalation` uses seconds, `pollForResponse` uses milliseconds. Always convert from the single source of truth (config value in ms) to avoid unit confusion.
- **Ignoring loadConfig errors:** When `loadConfig()` fails, silently fall back to `DEFAULT_TIMEOUTS`. Never crash the hook script due to a config issue -- the escalation must still work with defaults.
- **Importing the full config module in bridge-client:** Only import `loadConfig` and `DEFAULT_TIMEOUTS`. Do not import the full schema or other config infrastructure that is not needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config file reading + validation | Custom JSON.parse with manual field extraction | `loadConfig()` from `src/config/loader.ts` | Already handles file-not-found, invalid JSON, schema validation, Zod defaults |
| Default timeout values | Hardcoded constants in bridge-client.ts | `DEFAULT_TIMEOUTS` from `src/config/defaults.ts` | Single source of truth, already used by schema validation |
| Config file path resolution | Bare `process.cwd()` | `CLAUDE_PROJECT_DIR ?? process.cwd()` pattern | Same pattern used by `readPort()`, handles edge cases |

**Key insight:** All the infrastructure for this phase already exists. The work is purely about wiring existing config loading into hook scripts and removing hardcoded values.

## Common Pitfalls

### Pitfall 1: Unit Mismatch Between Bridge and Poll Timeouts

**What goes wrong:** Sending milliseconds to `createEscalation()` (which expects seconds) or seconds to `pollForResponse()` (which expects milliseconds).
**Why it happens:** Config stores timeouts in milliseconds (DEFAULT_TIMEOUTS uses 600_000), but the HTTP bridge API uses `timeout_seconds` (integer seconds).
**How to avoid:** Always read the config value in milliseconds, convert to seconds with `Math.ceil(timeoutMs / 1000)` for the bridge, and pass raw milliseconds to `pollForResponse()`.
**Warning signs:** Escalation times out in 600 seconds instead of 600,000 seconds (or vice versa).

### Pitfall 2: Config Read Failure Crashes Hook Script

**What goes wrong:** An exception from `loadConfig()` or `readFileSync()` propagates and crashes the hook script, causing Claude Code to lose the escalation entirely.
**Why it happens:** Forgetting to handle the `Result<EscalateConfig, ConfigError>` failure case.
**How to avoid:** Always check `result.success` and fall back to `DEFAULT_TIMEOUTS`. The helper function should never throw.
**Warning signs:** Hook script exits with non-zero code before creating any escalation.

### Pitfall 3: Forgetting to Pass timeoutMs to pollForResponse

**What goes wrong:** Reading config for `createEscalation()` but leaving `pollForResponse()` with its default 600,000ms.
**Why it happens:** The third parameter to `pollForResponse()` is optional with a default value, so TypeScript does not warn when it is omitted.
**How to avoid:** Always pass the config timeout to both `createEscalation()` AND `pollForResponse()` from the same variable.
**Warning signs:** PreToolUse polls for 10 minutes even when config says 5 minutes.

### Pitfall 4: on-post-tool-failure.ts Does Not Call pollForResponse

**What goes wrong:** Trying to pass a poll timeout to a script that does not poll.
**Why it happens:** `on-post-tool-failure.ts` is fire-and-forget -- it creates the escalation but does not wait for a response.
**How to avoid:** In `on-post-tool-failure.ts`, only update `timeout_seconds` in `createEscalation()`. Do not add `pollForResponse()` -- it is intentionally absent.
**Warning signs:** None (this is about not adding unnecessary code).

### Pitfall 5: tsup Bundling Fails for New Imports

**What goes wrong:** Adding imports from `src/config/` in `scripts/lib/bridge-client.ts` causes the bundled output to be incorrect.
**Why it happens:** The tsup config may not resolve cross-directory imports correctly when scripts import from src.
**How to avoid:** Verify the build works: `pnpm build` should succeed and the dist/ output should contain the config code bundled into the script files. The `noExternal: [/^(?!node:)/]` setting in tsup.config.ts bundles ALL non-builtin dependencies, which includes internal project imports.
**Warning signs:** Runtime error about missing module when running `node dist/scripts/on-permission-request.js`.

### Pitfall 6: Zod 4 .default({}) Not Applying Inner Defaults

**What goes wrong:** A config file with `"timeouts": {}` produces `undefined` for individual timeout fields.
**Why it happens:** Prior decision [01-02]: "Zod 4 nested .default({}) does not apply inner field defaults -- used spread constants."
**How to avoid:** The config schema already uses `TimeoutConfigSchema.default({ ...DEFAULT_TIMEOUTS })` at the root level, which provides all four field defaults. Individual fields also have `.default()` for partial objects. This is already handled -- just verify the existing tests confirm it.
**Warning signs:** `result.data.timeouts.permissionRequest` is undefined when config has `"timeouts": {}`.

## Code Examples

### Example 1: readTimeoutMs Helper in bridge-client.ts

```typescript
// Source: scripts/lib/bridge-client.ts (new addition)
import { resolve } from 'node:path';
import { loadConfig } from '../../src/config/loader.js';
import { DEFAULT_TIMEOUTS } from '../../src/config/defaults.js';

/** Event type keys matching the timeouts config section. */
type TimeoutEventType = keyof typeof DEFAULT_TIMEOUTS;

/**
 * Read the timeout for an event type from escalate.config.json.
 * Returns the value in milliseconds. Falls back to DEFAULT_TIMEOUTS
 * when config is missing, invalid, or the field is absent.
 */
export function readTimeoutMs(eventType: TimeoutEventType): number {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const configPath = resolve(projectDir, 'escalate.config.json');
  const result = loadConfig(configPath);
  if (result.success) {
    return result.data.timeouts[eventType];
  }
  return DEFAULT_TIMEOUTS[eventType];
}
```

### Example 2: Updated on-permission-request.ts

```typescript
// Source: scripts/on-permission-request.ts (updated)
import { readPort, createEscalation, pollForResponse, readTimeoutMs } from './lib/bridge-client.js';
import { buildPermissionRequestOutput } from './lib/output-helpers.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;
  const port = readPort();
  const timeoutMs = readTimeoutMs('permissionRequest');

  const esc = await createEscalation(port, {
    event_type: 'PermissionRequest',
    request_json: JSON.stringify(input),
    fallback_action: 'deny',
    timeout_seconds: Math.ceil(timeoutMs / 1000),
  });

  const result = await pollForResponse(port, esc.escalation_id, timeoutMs);
  process.stdout.write(buildPermissionRequestOutput(result));
  process.exit(0);
}
```

### Example 3: Updated on-post-tool-failure.ts (No Polling)

```typescript
// Source: scripts/on-post-tool-failure.ts (updated)
import { readPort, createEscalation, readTimeoutMs } from './lib/bridge-client.js';

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as Record<string, unknown>;
  const port = readPort();
  const timeoutMs = readTimeoutMs('postToolUseFailure');

  await createEscalation(port, {
    event_type: 'PostToolUseFailure',
    request_json: JSON.stringify(input),
    fallback_action: 'allow',
    timeout_seconds: Math.ceil(timeoutMs / 1000),
  });

  process.stdout.write(buildPostToolFailureOutput());
  process.exit(0);
}
```

### Example 4: Test for readTimeoutMs

```typescript
// Source: test/bridge-client.test.ts (new tests)
import { readTimeoutMs } from '../scripts/lib/bridge-client.js';
import { DEFAULT_TIMEOUTS } from '../src/config/defaults.js';

describe('readTimeoutMs', () => {
  it('returns default timeout when config file is missing', () => {
    vi.stubEnv('CLAUDE_PROJECT_DIR', '/nonexistent/path');
    const timeout = readTimeoutMs('permissionRequest');
    expect(timeout).toBe(DEFAULT_TIMEOUTS.permissionRequest);
  });

  it('returns config timeout when config file exists with custom value', () => {
    const tempDir = join(tmpdir(), `escalate-test-${String(Date.now())}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'escalate.config.json'),
      JSON.stringify({
        slack: { channelId: 'C0123456789' },
        timeouts: { permissionRequest: 120_000 },
      }),
    );
    vi.stubEnv('CLAUDE_PROJECT_DIR', tempDir);

    const timeout = readTimeoutMs('permissionRequest');
    expect(timeout).toBe(120_000);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns default for event type not in config timeouts', () => {
    const tempDir = join(tmpdir(), `escalate-test-${String(Date.now())}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'escalate.config.json'),
      JSON.stringify({
        slack: { channelId: 'C0123456789' },
      }),
    );
    vi.stubEnv('CLAUDE_PROJECT_DIR', tempDir);

    const timeout = readTimeoutMs('preToolUse');
    expect(timeout).toBe(DEFAULT_TIMEOUTS.preToolUse);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
```

## Detailed Change Analysis

### Change 1: Add readTimeoutMs to bridge-client.ts

**File:** `scripts/lib/bridge-client.ts`
**What:** Add a `readTimeoutMs()` function that reads the config and returns the event-type timeout in milliseconds.
**New imports:** `loadConfig` from `../../src/config/loader.js`, `DEFAULT_TIMEOUTS` from `../../src/config/defaults.js`, `resolve` from `node:path`
**Export:** `readTimeoutMs` (add to existing exports)
**Lines affected:** ~15 new lines

### Change 2: Update on-permission-request.ts

**File:** `scripts/on-permission-request.ts`
**What:** Import `readTimeoutMs`, call it for `'permissionRequest'`, replace hardcoded `600` with `Math.ceil(timeoutMs / 1000)`, pass `timeoutMs` to `pollForResponse`.
**Current hardcoded values:** `timeout_seconds: 600`, `pollForResponse(port, esc.escalation_id)` (uses default 600_000ms)
**New behavior:** Both timeout_seconds and pollForResponse use the config value (default: 600_000ms / 600s -- unchanged behavior with default config)

### Change 3: Update on-pre-tool-use.ts

**File:** `scripts/on-pre-tool-use.ts`
**What:** Same pattern as permission-request, but reads `'preToolUse'` timeout.
**Current hardcoded values:** `timeout_seconds: 300`, `pollForResponse(port, esc.escalation_id)` (uses default 600_000ms -- MISALIGNED)
**New behavior:** Both use config value (default: 300_000ms / 300s). **This also fixes the existing misalignment.**

### Change 4: Update on-stop.ts

**File:** `scripts/on-stop.ts`
**What:** Same pattern, reads `'stop'` timeout.
**Current hardcoded values:** `timeout_seconds: 600`, `pollForResponse(port, esc.escalation_id)` (uses default 600_000ms)
**New behavior:** Both use config value (default: 600_000ms / 600s)

### Change 5: Update on-post-tool-failure.ts

**File:** `scripts/on-post-tool-failure.ts`
**What:** Import `readTimeoutMs`, call it for `'postToolUseFailure'`, replace hardcoded `60`. No pollForResponse change needed (fire-and-forget).
**Current hardcoded values:** `timeout_seconds: 60`
**New behavior:** Uses config value (default: 60_000ms / 60s)

### Change 6: on-task-completed.ts -- No Change Needed

**File:** `scripts/on-task-completed.ts`
**What:** This script does NOT create an escalation or use timeouts. It only calls `requestSummary()`. No change needed.

### Change 7: hooks.json timeout values

**File:** `hooks/hooks.json`
**What:** The `"timeout"` field in hooks.json is the Claude Code hook timeout (how long Claude Code waits for the hook process). This is NOT the same as the escalation timeout. It should be >= the escalation timeout to avoid Claude Code killing the hook process before the escalation resolves.
**Current state:** PermissionRequest: 600, PreToolUse: 300, Stop: 600, PostToolUseFailure: 30, TaskCompleted: 30
**Decision:** These should stay as-is or be set to generous upper bounds. They are Claude Code's "max wait for hook process" and are separate from the config-driven escalation timeout. If a user sets a very long escalation timeout in config but hooks.json has a shorter Claude Code timeout, the hook process will be killed. This is an inherent limitation of the hooks.json static timeout -- it cannot be dynamically read from config.
**Recommendation:** Document this limitation. Users who increase escalation timeouts beyond hooks.json values need to also update hooks.json. This is a hooks.json authoring concern, not something the code can solve.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded timeout_seconds in each hook script | Read from escalate.config.json timeouts section | Phase 11 | Users can tune timeouts without code modification |

**Deprecated/outdated:**
- None

## Open Questions

1. **Should readTimeoutMs be memoized?**
   - What we know: `loadConfig()` reads from disk on every call. Hook scripts call it once per invocation (each script runs as a separate process).
   - What's unclear: Whether reading config adds meaningful latency.
   - Recommendation: No memoization needed. Each hook process runs once and exits. `loadConfig()` reads a small JSON file synchronously -- negligible overhead. Memoization adds complexity for no benefit.

2. **Should hooks.json timeout values also be configurable?**
   - What we know: hooks.json `"timeout"` is Claude Code's process-level timeout. It is static JSON -- cannot be dynamically read from config at runtime.
   - What's unclear: Whether users need to change these.
   - Recommendation: Out of scope for this phase. Document in code comments that hooks.json timeout must be >= the escalation timeout configured in escalate.config.json. If a user needs a longer escalation timeout, they must also edit hooks.json.

3. **Should pollForResponse timeout exactly match or have a small buffer?**
   - What we know: The server-side SQLite timeout (via `timeout_seconds`) and the client-side poll timeout (via `pollForResponse timeoutMs`) both need to be aligned. If the poll timeout is slightly shorter than the server timeout, the client might give up before the server marks the record as timed_out.
   - What's unclear: Whether exact match or buffer is better.
   - Recommendation: Use the exact same value. The server-side `checkTimeout()` runs on each GET poll request, so if the server timeout fires first, the next poll iteration will see `status: 'timed_out'` and return immediately. If the client timeout fires first, it returns `{ status: 'timed_out' }` locally. Either way, the behavior is correct. Exact match is simpler and less confusing.

## Sources

### Primary (HIGH confidence)

- **Codebase inspection** -- all findings verified by reading actual source files
  - `scripts/on-permission-request.ts` -- hardcoded `timeout_seconds: 600` (line 20), no pollForResponse timeout (line 23)
  - `scripts/on-pre-tool-use.ts` -- hardcoded `timeout_seconds: 300` (line 20), no pollForResponse timeout (line 23)
  - `scripts/on-stop.ts` -- hardcoded `timeout_seconds: 600` (line 26), no pollForResponse timeout (line 29)
  - `scripts/on-post-tool-failure.ts` -- hardcoded `timeout_seconds: 60` (line 20), no pollForResponse (fire-and-forget)
  - `scripts/lib/bridge-client.ts` -- `readPort()` uses `CLAUDE_PROJECT_DIR` (line 34), `pollForResponse` defaults to 600_000ms (line 77)
  - `src/config/loader.ts` -- `loadConfig()` with file-not-found/invalid-JSON/validation handling (lines 33-68)
  - `src/config/defaults.ts` -- `DEFAULT_TIMEOUTS` with all four event types (lines 9-18)
  - `src/config/schema.ts` -- `TimeoutConfigSchema` with per-field defaults (lines 31-36)
  - `hooks/hooks.json` -- Claude Code process-level timeout values (lines 10, 22, 33, 44, 56)
  - `tsup.config.ts` -- `noExternal: [/^(?!node:)/]` bundles all non-builtin imports (line 43)

### Secondary (MEDIUM confidence)

- **REQUIREMENTS.md** -- IPC-03 definition: "Hook scripts poll SQLite for user response with configurable timeout (default 10 minutes for PermissionRequest)"
- **ROADMAP.md** -- Phase 11 success criteria (lines 219-221)
- **Prior decision [01-02]** -- "Zod 4 nested .default({}) does not apply inner field defaults -- used spread constants"
- **Prior decision [05-03]** -- "Config re-read on every POST /escalations for mid-session rule tuning" (server-side pattern, but hook scripts run as one-shot processes)

### Tertiary (LOW confidence)

- None -- all findings verified from primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, uses existing config infrastructure
- Architecture: HIGH -- straightforward wiring of existing `loadConfig()` into hook scripts, follows established `readPort()` pattern
- Pitfalls: HIGH -- all documented from direct codebase inspection, dual-timeout alignment explicitly analyzed

**Research date:** 2026-02-20
**Valid until:** Indefinite (gap closure against stable codebase, not version-sensitive)
