# Phase 9: Config, Manifest, and Documentation Fixes - Research

**Researched:** 2026-02-19
**Domain:** Configuration accuracy, documentation correctness, manifest consistency
**Confidence:** HIGH

## Summary

Phase 9 is a gap-closure phase that addresses four integration issues (INT-02 through INT-05) discovered during the v1.0 milestone audit. All four issues are documentation/configuration mismatches rather than logic bugs -- the functional code is correct, but the metadata and docs do not accurately reflect what the code expects.

The four fixes are: (1) README documents wrong env var names and a non-existent signing secret, (2) `.mcp.json` does not pass Slack/OpenAI env vars to the MCP server process, (3) `auditLog.enabled: false` in `escalate.config.json` has no effect because `http-bridge.ts` calls `appendAuditEntry()` unconditionally, and (4) `package.json` and `mcp-server.ts` say version `0.1.0` while `plugin.json` says `1.0.0`.

**Primary recommendation:** This is a single-plan phase. All four fixes are independent text/config edits with one small code change (audit log gate). A single plan with four tasks can handle it cleanly.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CFG-04 | All secrets via environment variables (ESCALATE_SLACK_BOT_TOKEN, ESCALATE_SLACK_APP_TOKEN) -- no hardcoded credentials | README fix (INT-02): update env var names from SLACK_BOT_TOKEN/SLACK_APP_TOKEN/SLACK_SIGNING_SECRET to ESCALATE_SLACK_BOT_TOKEN/ESCALATE_SLACK_APP_TOKEN. .mcp.json fix (INT-03): add env vars to MCP server env block. Code already reads correct env var names in `src/config/loader.ts` lines 79/87. |
| PLAT-03 | Slack adapter implements full MessagingAdapter interface using @slack/bolt Socket Mode | .mcp.json fix (INT-03): Slack adapter code is functional but env vars must be passed through `.mcp.json` for Claude Code MCP server processes to receive them. |
| INTL-03 | Audit log -- append-only JSON file recording every escalation | Audit log gate (INT-04): audit logging code works (`src/intelligence/audit.ts`), but `auditLog.enabled` config field is never checked in `src/server/http-bridge.ts` lines 232-246. Need to read config and skip `appendAuditEntry()` when disabled. |
| PLAT-04 | Plugin packaged as Claude Code plugin -- plugin.json manifest, hooks.json, .mcp.json with ${CLAUDE_PLUGIN_ROOT} paths | Version sync (INT-05): `plugin.json` is 1.0.0, but `package.json` (line 3) and `mcp-server.ts` (line 24) both say 0.1.0. All three must say 1.0.0. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase modifies existing files only.

| Library | Version | Purpose | Already In Use |
|---------|---------|---------|----------------|
| N/A | N/A | N/A | N/A |

### Supporting

No supporting libraries needed.

### Alternatives Considered

None -- this phase is pure fixes to existing config/docs/code.

**Installation:**
```bash
# No new dependencies
```

## Architecture Patterns

### Recommended Project Structure

No structural changes. All edits are in-place to existing files:

```
escalate/
├── .claude-plugin/plugin.json    # Version bump: 0.1.0 -> 1.0.0 (already 1.0.0)
├── .mcp.json                     # Add env var passthrough
├── README.md                     # Fix env var documentation
├── package.json                  # Version bump: 0.1.0 -> 1.0.0
├── src/server/mcp-server.ts      # Version bump: 0.1.0 -> 1.0.0
└── src/server/http-bridge.ts     # Add auditLog.enabled gate
```

### Pattern 1: Conditional Audit Logging

**What:** Gate `appendAuditEntry()` calls behind `config.auditLog.enabled` check.

**When to use:** When the config is already loaded in the request handler (it is -- `loadConfig()` is called on every POST /escalations request on line 191).

**Current code (http-bridge.ts lines 232-246):**
```typescript
// Audit log every decision (failure must NOT block escalation)
const auditLogPath = options.auditLogPath ?? defaultAuditLogPath();
try {
  appendAuditEntry(auditLogPath, {
    timestamp: new Date().toISOString(),
    eventType: event_type,
    decision: decision === 'escalate' ? 'escalated' : decision === 'auto_approve' ? 'auto_approved' : 'quiet_hours_suppressed',
    reason,
    ...(toolName !== undefined ? { toolName } : {}),
    ...(filePaths.length > 0 ? { filePaths } : {}),
    ...(matchedRuleDescription !== undefined ? { matchedRule: matchedRuleDescription } : {}),
  });
} catch (auditErr: unknown) {
  console.error('[escalate] Audit log write failed (non-blocking):', auditErr);
}
```

**Fix pattern:**
```typescript
// Audit log every decision (failure must NOT block escalation)
// Respect auditLog.enabled config (defaults to true when config unavailable)
const auditEnabled = config?.auditLog.enabled ?? true;
if (auditEnabled) {
  const auditLogPath = options.auditLogPath ?? defaultAuditLogPath();
  try {
    appendAuditEntry(auditLogPath, { /* ... same entry ... */ });
  } catch (auditErr: unknown) {
    console.error('[escalate] Audit log write failed (non-blocking):', auditErr);
  }
}
```

**Key detail:** The `config` variable is already available at this point (loaded on line 191-194). When config loading fails, `config` is `undefined`. The nullish coalescing `config?.auditLog.enabled ?? true` ensures audit logging defaults to ON when config is unavailable -- safe default.

### Pattern 2: .mcp.json Env Var Passthrough

**What:** Claude Code MCP server processes receive environment variables declared in `.mcp.json`'s `env` block.

**Current .mcp.json:**
```json
{
  "mcpServers": {
    "escalate": {
      "command": "node",
      "args": ["--no-warnings=ExperimentalWarning", "${CLAUDE_PLUGIN_ROOT}/dist/server/index.js"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
}
```

**Fix pattern:** Add the three env vars that the code expects. Use `${VAR_NAME}` syntax so Claude Code passes the parent env values through.

```json
{
  "mcpServers": {
    "escalate": {
      "command": "node",
      "args": ["--no-warnings=ExperimentalWarning", "${CLAUDE_PLUGIN_ROOT}/dist/server/index.js"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}",
        "ESCALATE_SLACK_BOT_TOKEN": "${ESCALATE_SLACK_BOT_TOKEN}",
        "ESCALATE_SLACK_APP_TOKEN": "${ESCALATE_SLACK_APP_TOKEN}",
        "ESCALATE_OPENAI_API_KEY": "${ESCALATE_OPENAI_API_KEY}"
      }
    }
  }
}
```

**Key detail:** The `${VAR_NAME}` syntax in `.mcp.json` env blocks tells Claude Code to substitute from the parent process environment. This is the standard pattern per the plugin authoring docs (CLAUDE.md: "Use `${CLAUDE_PLUGIN_ROOT}` in paths and environment variables").

### Anti-Patterns to Avoid

- **Hardcoding tokens in .mcp.json:** Never put actual secret values in .mcp.json. Always use `${VAR_NAME}` references.
- **Changing env var names in code:** The code already uses the correct ESCALATE_-prefixed names. The fix is in docs/config, not code.
- **Removing SLACK_SIGNING_SECRET from code:** It was never in the code. Only remove the reference from README.
- **Bumping version to something other than 1.0.0:** The audit report specifies 1.0.0. plugin.json already has this. Sync the other two.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| N/A | N/A | N/A | This phase has no hand-roll risks -- all changes are simple edits |

**Key insight:** This phase is entirely about consistency, not new functionality. The risk is incomplete edits, not wrong architecture.

## Common Pitfalls

### Pitfall 1: Incomplete README Env Var Update

**What goes wrong:** Fix the env var names in the code block but miss them in surrounding prose text.
**Why it happens:** README may reference env vars in multiple places (setup section, troubleshooting, etc.).
**How to avoid:** Search README.md for ALL occurrences of `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `SLACK_SIGNING_SECRET`. Replace or remove every one.
**Warning signs:** Grep for old env var names after fix.

**Current occurrences in README.md:**
- Line 64: `export SLACK_BOT_TOKEN="xoxb-..."` -- WRONG, should be `ESCALATE_SLACK_BOT_TOKEN`
- Line 65: `export SLACK_APP_TOKEN="xapp-..."` -- WRONG, should be `ESCALATE_SLACK_APP_TOKEN`
- Line 66: `export SLACK_SIGNING_SECRET="..."` -- WRONG, should be removed entirely (not used by code)

### Pitfall 2: .mcp.json Env Vars Not Using ${} Syntax

**What goes wrong:** Writing literal env var values or bare names without `${}` wrapping.
**Why it happens:** Confusing `.mcp.json` env block syntax with shell syntax.
**How to avoid:** Always use `"${VAR_NAME}"` format for env var references.
**Warning signs:** Plugin works locally but fails when installed from marketplace cache.

### Pitfall 3: Audit Log Gate Breaks Default Behavior

**What goes wrong:** Setting `auditEnabled = config?.auditLog.enabled` without a fallback makes audit logging default to OFF when config is missing.
**Why it happens:** When `config` is `undefined`, `config?.auditLog.enabled` evaluates to `undefined`, which is falsy.
**How to avoid:** Use `config?.auditLog.enabled ?? true` to default to enabled when config is unavailable.
**Warning signs:** Test that creates an escalation without a config file should still produce audit entries.

### Pitfall 4: Version String Format Inconsistency

**What goes wrong:** Writing `"version": "v1.0.0"` or `"1.0"` instead of `"1.0.0"`.
**Why it happens:** Copy-paste from release notes which sometimes use `v` prefix.
**How to avoid:** Use exact semver `"1.0.0"` everywhere. No `v` prefix.
**Warning signs:** Grep for version strings after fix.

### Pitfall 5: README Roadmap Section Out of Date

**What goes wrong:** README has a roadmap section listing phases 1-7 with checkboxes, some checked and some not. Doesn't reflect the actual completed state.
**Why it happens:** README was written early and never updated as phases completed.
**How to avoid:** Update the roadmap section to reflect all phases (including 8 and 9) as complete, or simplify to a "v1.0 complete" statement.
**Warning signs:** User reads README and thinks features are missing.

## Code Examples

### Example 1: Fix README Env Var Block

**Before (README.md lines 63-67):**
```markdown
### Environment Variables

Set these in your shell or `.env` (never commit secrets):

```bash
export SLACK_BOT_TOKEN="xoxb-..."       # Bot User OAuth Token
export SLACK_APP_TOKEN="xapp-..."       # App-Level Token (Socket Mode)
export SLACK_SIGNING_SECRET="..."       # Signing Secret (from Basic Information)
```
```

**After:**
```markdown
### Environment Variables

Set these in your shell or `.env` (never commit secrets):

```bash
export ESCALATE_SLACK_BOT_TOKEN="xoxb-..."    # Bot User OAuth Token
export ESCALATE_SLACK_APP_TOKEN="xapp-..."    # App-Level Token (Socket Mode)
```

Optional (only needed for voice note transcription):

```bash
export ESCALATE_OPENAI_API_KEY="sk-..."       # OpenAI API key for Whisper
```
```

### Example 2: Version Sync in package.json

**Before (package.json line 3):**
```json
"version": "0.1.0",
```

**After:**
```json
"version": "1.0.0",
```

### Example 3: Version Sync in mcp-server.ts

**Before (src/server/mcp-server.ts line 24):**
```typescript
{ name: 'escalate', version: '0.1.0' },
```

**After:**
```typescript
{ name: 'escalate', version: '1.0.0' },
```

## Detailed Gap Analysis

### INT-02: README Documents Wrong Environment Variable Names

**Severity:** HIGH
**Files to modify:** `README.md`

**Current state:** README lines 64-66 tell users to set:
- `SLACK_BOT_TOKEN` -- code expects `ESCALATE_SLACK_BOT_TOKEN` (src/config/loader.ts:79)
- `SLACK_APP_TOKEN` -- code expects `ESCALATE_SLACK_APP_TOKEN` (src/config/loader.ts:87)
- `SLACK_SIGNING_SECRET` -- not used anywhere in code (confirmed: grep for SIGNING_SECRET in src/ returns zero results)

**Fix:** Replace env var names in README. Remove SLACK_SIGNING_SECRET line. Optionally add ESCALATE_OPENAI_API_KEY (used in src/slack/adapter.ts:370 and src/server/index.ts:99 for voice note transcription).

**Additionally:** The README Roadmap section (lines 150-157) is stale -- lists phases 1-7 with some unchecked. Should be updated to reflect v1.0 completion.

### INT-03: .mcp.json Missing Slack Env Var Passthrough

**Severity:** HIGH
**Files to modify:** `.mcp.json`

**Current state:** `.mcp.json` env block only includes `CLAUDE_PROJECT_DIR`. The MCP server process needs `ESCALATE_SLACK_BOT_TOKEN`, `ESCALATE_SLACK_APP_TOKEN`, and `ESCALATE_OPENAI_API_KEY` to start the Slack adapter and voice note transcription.

**Code references:**
- `src/config/loader.ts:79` -- reads `ESCALATE_SLACK_BOT_TOKEN`
- `src/config/loader.ts:87` -- reads `ESCALATE_SLACK_APP_TOKEN`
- `src/server/index.ts:99` -- reads `ESCALATE_OPENAI_API_KEY` (fallback to `OPENAI_API_KEY`)
- `src/slack/adapter.ts:370` -- reads `ESCALATE_OPENAI_API_KEY` (fallback to `OPENAI_API_KEY`)

**Fix:** Add three env var entries to `.mcp.json` env block using `${VAR_NAME}` syntax.

**Note on OPENAI_API_KEY fallback:** The code falls back to `OPENAI_API_KEY` if `ESCALATE_OPENAI_API_KEY` is not set. We could add `OPENAI_API_KEY` to `.mcp.json` as well for convenience, but the success criteria only requires the ESCALATE-prefixed variants. Adding both is a reasonable enhancement.

### INT-04: auditLog.enabled Config Field Never Read

**Severity:** MEDIUM
**Files to modify:** `src/server/http-bridge.ts`

**Current state:**
- Config schema defines `auditLog.enabled` (src/config/schema.ts:104-106), defaults to `true`
- `http-bridge.ts` calls `appendAuditEntry()` unconditionally at line 234
- The `config` variable IS available at that point (loaded on line 191-194)
- Setting `auditLog.enabled: false` has no effect

**Fix:** Wrap the `appendAuditEntry()` call in an `if (config?.auditLog.enabled ?? true)` guard.

**Testing strategy:**
- Unit test: create HTTP bridge, POST /escalations with a config that has `auditLog.enabled: false`, verify no audit file is written
- Verify default behavior: POST /escalations with default config (no auditLog field), verify audit entries ARE written
- The existing test infrastructure in `test/server/http-bridge.test.ts` does not set an audit log path, so audit writes go to the default path based on `process.cwd()`. A new test could use a temp directory and check file existence.

**Design decision:** The gate should be at the call site in `http-bridge.ts`, not inside `appendAuditEntry()` itself. The `appendAuditEntry()` function is a low-level utility -- callers decide whether to call it. This matches the existing pattern where the http-bridge already makes the decision about what to audit.

### INT-05: Version Mismatch Across Manifests

**Severity:** MEDIUM
**Files to modify:** `package.json`, `src/server/mcp-server.ts`

**Current state:**
- `.claude-plugin/plugin.json:3` -- `"version": "1.0.0"` (correct)
- `package.json:3` -- `"version": "0.1.0"` (wrong)
- `src/server/mcp-server.ts:24` -- `version: '0.1.0'` (wrong)

**Fix:** Change both to `"1.0.0"`.

**Note:** An alternative approach would be to read the version from `package.json` at runtime in `mcp-server.ts`, but that adds complexity for minimal benefit. Hardcoding `'1.0.0'` matches the current pattern.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | N/A | N/A | N/A |

This phase involves no technology changes -- purely documentation and configuration accuracy.

**Deprecated/outdated:**
- None

## Open Questions

1. **Should OPENAI_API_KEY also be passed through .mcp.json?**
   - What we know: Code falls back to `OPENAI_API_KEY` when `ESCALATE_OPENAI_API_KEY` is unset (src/server/index.ts:99, src/slack/adapter.ts:370)
   - What's unclear: Whether adding `OPENAI_API_KEY` to `.mcp.json` is expected by the success criteria
   - Recommendation: Only add `ESCALATE_OPENAI_API_KEY` per success criteria. The fallback to `OPENAI_API_KEY` is a convenience for dev environments and may already be inherited. Keep .mcp.json focused on ESCALATE-prefixed vars.

2. **Should the README Roadmap section be updated?**
   - What we know: The roadmap (README lines 150-157) lists phases 1-7 with some checked and some not. The actual project has 9 phases, all complete.
   - What's unclear: Whether this is in scope for Phase 9 (not explicitly in success criteria)
   - Recommendation: Update it as part of the README fix since we are editing README anyway. It is reasonable to update the roadmap to show v1.0 complete. But this is non-blocking -- the planner can decide.

3. **Should the test for audit log gate be in http-bridge.test.ts or a new test file?**
   - What we know: `test/server/http-bridge.test.ts` exists but does not test audit logging. `test/intelligence/audit.test.ts` tests the `appendAuditEntry`/`readAuditLog` functions directly.
   - What's unclear: Where the gate test best belongs
   - Recommendation: Add to `test/server/http-bridge.test.ts` since the gate is in the http-bridge request handler. This tests the integration between config and audit logging at the HTTP level.

## Sources

### Primary (HIGH confidence)

- **Codebase inspection** -- all findings verified by reading actual source files
  - `src/config/loader.ts` -- env var names ESCALATE_SLACK_BOT_TOKEN (line 79), ESCALATE_SLACK_APP_TOKEN (line 87)
  - `src/config/schema.ts` -- AuditLogSchema with `enabled: boolean` (lines 104-106)
  - `src/server/http-bridge.ts` -- unconditional `appendAuditEntry()` call (lines 232-246), config loaded on lines 191-194
  - `src/server/mcp-server.ts` -- version string `'0.1.0'` (line 24)
  - `.claude-plugin/plugin.json` -- version `"1.0.0"` (line 3)
  - `package.json` -- version `"0.1.0"` (line 3)
  - `.mcp.json` -- env block with only CLAUDE_PROJECT_DIR (lines 6-8)
  - `README.md` -- wrong env var names (lines 64-66)

### Secondary (MEDIUM confidence)

- **v1.0 Milestone Audit** (`.planning/v1.0-MILESTONE-AUDIT.md`) -- defines INT-02 through INT-05 gaps
- **REQUIREMENTS.md** -- CFG-04, PLAT-03, INTL-03, PLAT-04 requirement definitions
- **ROADMAP.md** -- Phase 9 success criteria (lines 182-185)

### Tertiary (LOW confidence)

- None -- all findings verified from primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, pure edits
- Architecture: HIGH -- one small code change (audit gate) follows existing patterns exactly
- Pitfalls: HIGH -- all documented from direct codebase inspection

**Research date:** 2026-02-19
**Valid until:** Indefinite (these are bug fixes against stable codebase, not version-sensitive)
