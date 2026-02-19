---
phase: 11-read-hook-timeouts-from-config
plan: 01
subsystem: hooks
tags: [config, timeouts, bridge-client, hook-scripts]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: config schema, defaults, and loader infrastructure
  - phase: 04-hook-scripts-and-escalation
    provides: hook scripts and bridge-client library
provides:
  - readTimeoutMs() helper in bridge-client for config-driven timeout resolution
  - Config-driven timeouts in all 4 hook scripts (no hardcoded values)
affects: [hook-scripts, bridge-client, escalation-timeouts]

# Tech tracking
tech-stack:
  added: []
  patterns: [config-driven hook parameters via shared helper]

key-files:
  created: []
  modified:
    - scripts/lib/bridge-client.ts
    - scripts/on-permission-request.ts
    - scripts/on-pre-tool-use.ts
    - scripts/on-stop.ts
    - scripts/on-post-tool-failure.ts
    - test/bridge-client.test.ts

key-decisions:
  - "readTimeoutMs resolves config path using same CLAUDE_PROJECT_DIR pattern as readPort"
  - "Config values are milliseconds throughout; Math.ceil(ms/1000) conversion at call site for bridge timeout_seconds"
  - "Fixed preToolUse timeout_seconds/pollForResponse misalignment (was 300s bridge vs 600s poll default)"

patterns-established:
  - "Config helper pattern: read config via loadConfig, fall back to DEFAULT_* constants on failure"
  - "Timeout conversion pattern: Math.ceil(timeoutMs / 1000) for bridge timeout_seconds"

requirements-completed: [IPC-03]

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 11 Plan 01: Read Hook Timeouts from Config Summary

**Config-driven escalation timeouts via readTimeoutMs() helper, replacing all hardcoded values in 4 hook scripts**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-19T23:15:35Z
- **Completed:** 2026-02-19T23:18:03Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added `readTimeoutMs()` helper to bridge-client that reads escalation timeouts from `escalate.config.json` with `DEFAULT_TIMEOUTS` fallback
- Replaced all hardcoded `timeout_seconds` values in 4 hook scripts with config-driven `Math.ceil(readTimeoutMs() / 1000)`
- Fixed pre-existing misalignment in on-pre-tool-use.ts where `timeout_seconds` was 300s but `pollForResponse` defaulted to 600s
- Added 3 tests covering missing config, custom config value, and partial config (schema defaults)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add readTimeoutMs helper to bridge-client and tests** - `1375cca` (feat)
2. **Task 2: Update all 4 hook scripts to use config-driven timeouts** - `0ad9420` (feat)

## Files Created/Modified
- `scripts/lib/bridge-client.ts` - Added readTimeoutMs() helper, TimeoutEventType type, loadConfig/DEFAULT_TIMEOUTS imports
- `scripts/on-permission-request.ts` - Config-driven permissionRequest timeout with explicit pollForResponse timeoutMs
- `scripts/on-pre-tool-use.ts` - Config-driven preToolUse timeout, fixed timeout_seconds/pollForResponse mismatch
- `scripts/on-stop.ts` - Config-driven stop timeout with explicit pollForResponse timeoutMs
- `scripts/on-post-tool-failure.ts` - Config-driven postToolUseFailure timeout (fire-and-forget, no polling)
- `test/bridge-client.test.ts` - 3 new readTimeoutMs tests (missing config, custom value, partial config)

## Decisions Made
- readTimeoutMs resolves config path using the same `CLAUDE_PROJECT_DIR ?? process.cwd()` pattern as readPort for consistency
- Config values stay in milliseconds throughout the pipeline; only converted to seconds at the `timeout_seconds` call site via `Math.ceil(timeoutMs / 1000)`
- Fixed the pre-existing preToolUse timeout misalignment where bridge got 300s but pollForResponse used 600s default -- now both use the same config-derived value

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Users can optionally add a `timeouts` section to their `escalate.config.json` to customize escalation wait times.

## Next Phase Readiness
- All hook scripts now read timeouts from config, closing the IPC-03 requirement
- This is the final phase (11 of 11) -- project is feature-complete

## Self-Check: PASSED

All 6 modified files verified present. Both task commits (1375cca, 0ad9420) verified in git log.

---
*Phase: 11-read-hook-timeouts-from-config*
*Completed: 2026-02-20*
