---
phase: 01-foundation
plan: 02
subsystem: config
tags: [zod, config-validation, tdd, environment-variables, result-type]

# Dependency graph
requires:
  - phase: 01-foundation-01
    provides: ESM TypeScript project skeleton, Result<T, E> type for error handling
provides:
  - Zod 4 config schema with validated defaults for timeouts and escalation policies
  - Config file loader with structured error codes (FILE_NOT_FOUND, INVALID_JSON, VALIDATION_FAILED)
  - Environment variable secret loader for Slack tokens (MISSING_ENV_VAR error)
  - Example escalate.config.json with minimal required configuration
affects: [02-state-store, 03-slack-adapter, 04-hooks, 05-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      Zod 4 nested defaults require spread constants not empty objects,
      Config file never contains secrets -- secrets come from environment variables,
      TDD RED-GREEN-REFACTOR for config loading behavior,
    ]

key-files:
  created:
    - src/config/defaults.ts
    - src/config/schema.ts
    - src/config/loader.ts
    - src/config/index.ts
    - escalate.config.json
    - test/config/schema.test.ts
    - test/config/loader.test.ts
  modified:
    - src/index.ts
    - tsconfig.json

key-decisions:
  - "Zod 4 nested .default({}) does not apply inner field defaults -- used spread constants as default values instead"
  - "Added test/**/*.ts to tsconfig.json include for ESLint project service compatibility"

patterns-established:
  - "Zod 4 safeParse returns Result-like { success, data/error } -- aligns with project Result type"
  - "Config errors use structured codes (FILE_NOT_FOUND, INVALID_JSON, VALIDATION_FAILED, MISSING_ENV_VAR) for pattern matching"
  - "Secrets never in config files -- ESCALATE_SLACK_BOT_TOKEN and ESCALATE_SLACK_APP_TOKEN from process.env"
  - "Test fixtures created/cleaned per test in test/fixtures/ directory"

requirements-completed: [CFG-01, CFG-04]

# Metrics
duration: 4min
completed: 2026-02-18
---

# Phase 1 Plan 02: Config Schema Validation and Loading Summary

**Zod 4 config schema with timeout/policy defaults, file loader with 4 structured error codes, and env var secret validation using TDD**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-18T17:50:18Z
- **Completed:** 2026-02-18T17:54:42Z
- **Tasks:** 1 (TDD: RED + GREEN + REFACTOR)
- **Files created:** 7
- **Files modified:** 2

## Accomplishments

- Zod 4 schema validates escalate.config.json with sensible defaults for all 4 timeout values and 4 escalation policies
- Config loader returns Result type with 4 structured error codes: FILE_NOT_FOUND, INVALID_JSON, VALIDATION_FAILED, MISSING_ENV_VAR
- Secret loader validates ESCALATE_SLACK_BOT_TOKEN and ESCALATE_SLACK_APP_TOKEN environment variables
- 21 comprehensive tests (13 schema + 8 loader) covering all validation edges and error paths
- Full TDD cycle: RED (failing tests) -> GREEN (minimal implementation) -> REFACTOR (lint, typecheck, format, build)

## Task Commits

Each TDD phase was committed atomically:

1. **RED: Failing tests for schema and loader** - `35def10` (test)
2. **GREEN: Config schema, loader, and secret validation** - `24e48b7` (feat)
3. **REFACTOR: tsconfig test inclusion, Prettier formatting** - `836d51d` (refactor)

## Files Created/Modified

- `src/config/defaults.ts` - DEFAULT_TIMEOUTS and DEFAULT_ESCALATION_POLICIES constants
- `src/config/schema.ts` - Zod 4 schemas: UrgencyLevel, SlackConfig, TimeoutConfig, EscalationPolicy, EventEscalationConfig, EscalateConfig
- `src/config/loader.ts` - loadConfig (file -> Result) and loadSecrets (env -> Result) with ConfigError interface
- `src/config/index.ts` - Barrel re-export for config module
- `escalate.config.json` - Example config with minimal required field (slack.channelId)
- `test/config/schema.test.ts` - 13 tests for schema validation (valid, invalid, defaults, edge cases)
- `test/config/loader.test.ts` - 8 tests for file loading, JSON parsing, schema validation, and secret env vars
- `src/index.ts` - Added config module re-exports
- `tsconfig.json` - Added test/**/*.ts to include for ESLint project service

## Decisions Made

- **Zod 4 nested defaults workaround:** `.default({})` on nested objects in Zod 4 uses the literal empty object, skipping inner field defaults. Fixed by spreading DEFAULT constants as the default value (e.g., `TimeoutConfigSchema.default({ ...DEFAULT_TIMEOUTS })`).
- **Test files in tsconfig:** Added `test/**/*.ts` to tsconfig `include` so ESLint's project service can type-check test files. This is preferable to `allowDefaultProject` which only handles root-level files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod 4 nested .default({}) does not apply inner defaults**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** `TimeoutConfigSchema.default({})` produced `{ timeouts: {} }` instead of `{ timeouts: { permissionRequest: 600000, ... } }`
- **Fix:** Changed to `TimeoutConfigSchema.default({ ...DEFAULT_TIMEOUTS })` and same for escalation policies
- **Files modified:** src/config/schema.ts
- **Verification:** All 21 tests pass, defaults are correctly applied
- **Committed in:** 24e48b7 (GREEN commit)

**2. [Rule 3 - Blocking] Test files not in ESLint project service scope**
- **Found during:** Task 1 (REFACTOR phase)
- **Issue:** ESLint reported test files not found by project service; `allowDefaultProject` only covers root-level globs
- **Fix:** Added `test/**/*.ts` to tsconfig.json `include` array
- **Files modified:** tsconfig.json
- **Verification:** `pnpm run lint` exits 0, all test files are type-checked
- **Committed in:** 836d51d (REFACTOR commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes were necessary for correct Zod 4 behavior and ESLint compatibility. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Config schema and loader ready for downstream phases (IPC, Slack adapter, hooks)
- All exports available via `import { loadConfig, loadSecrets, EscalateConfigSchema } from 'escalate'`
- Result-based error handling established: consumers pattern-match on error codes
- Phase 1 (Foundation) is now fully complete -- Phase 2 can proceed

## Self-Check: PASSED

- All 7 created files verified present on disk
- All 2 modified files verified updated
- Commit 35def10 (RED) verified in git log
- Commit 24e48b7 (GREEN) verified in git log
- Commit 836d51d (REFACTOR) verified in git log
- All 5 npm scripts (test, typecheck, build, lint, format:check) exit 0
- escalate.config.json contains no secrets

---
*Phase: 01-foundation*
*Completed: 2026-02-18*
