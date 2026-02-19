---
phase: 07-plugin-packaging
plan: 01
subsystem: infra
tags: [node-sqlite, tsup, bundling, esbuild, native-addon-removal]

# Dependency graph
requires:
  - phase: 02-state-store
    provides: SQLite state store using better-sqlite3
  - phase: 06-multimodal-responses
    provides: Full codebase with all features using better-sqlite3
provides:
  - "node:sqlite migration replacing better-sqlite3 across all source and test files"
  - "Self-contained tsup bundle config with all npm dependencies inlined"
  - "Correct dist/ output paths matching .mcp.json and hooks.json references"
affects: [07-plugin-packaging]

# Tech tracking
tech-stack:
  added: []
  removed: [better-sqlite3, "@types/better-sqlite3"]
  patterns: ["node:sqlite DatabaseSync/StatementSync for synchronous SQLite", "noExternal regex for self-contained bundling", "onSuccess hook to patch esbuild node: prefix stripping"]

key-files:
  created: []
  modified:
    - src/state/schema.ts
    - src/state/store.ts
    - src/server/index.ts
    - tsup.config.ts
    - package.json
    - test/state/store.test.ts
    - test/server/http-bridge.test.ts
    - test/slack/adapter.test.ts

key-decisions:
  - "Used intermediate `as unknown as T` casts for node:sqlite return types (Record<string, SQLOutputValue> -> domain types)"
  - "Used Number(result.changes) for number|bigint compatibility in resolve method"
  - "Used noExternal: [/^(?!node:)/] to bundle npm deps while keeping node: builtins external"
  - "Added onSuccess post-build hook to patch bare sqlite imports back to node:sqlite (esbuild strips node: prefix)"

patterns-established:
  - "node:sqlite type casting: `stmt.get(...) as unknown as RowType | undefined` for typed query results"
  - "Self-contained bundling: noExternal regex + onSuccess sqlite patch for plugin distribution"

requirements-completed: [PLAT-05]

# Metrics
duration: 12min
completed: 2026-02-19
---

# Phase 7 Plan 1: SQLite & Bundle Migration Summary

**Migrated better-sqlite3 to node:sqlite and configured tsup for self-contained bundling with all npm dependencies inlined**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-19T19:47:43Z
- **Completed:** 2026-02-19T19:59:48Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Eliminated the only native addon dependency (better-sqlite3) by migrating to Node.js built-in node:sqlite module
- Configured tsup to bundle ALL npm dependencies (MCP SDK, Slack Bolt, OpenAI, Zod) into dist/ for zero-runtime-dependency plugin
- Output paths match .mcp.json and hooks.json references exactly (dist/server/index.js, dist/scripts/*.js)
- All 142 tests pass, TypeScript compiles cleanly, build produces correct output

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate better-sqlite3 to node:sqlite** - `0431a9f` (feat)
2. **Task 2: Configure tsup for self-contained bundling** - `cf0b394` (feat)

## Files Created/Modified
- `src/state/schema.ts` - Database schema initialization using node:sqlite DatabaseSync
- `src/state/store.ts` - Escalation store using node:sqlite DatabaseSync/StatementSync
- `src/server/index.ts` - Server entrypoint using node:sqlite DatabaseSync constructor
- `tsup.config.ts` - Self-contained bundle config with object entries, noExternal, and sqlite patch
- `package.json` - Removed better-sqlite3 and @types/better-sqlite3 dependencies
- `pnpm-lock.yaml` - Updated lockfile after dependency removal
- `test/state/store.test.ts` - Tests migrated to node:sqlite DatabaseSync
- `test/server/http-bridge.test.ts` - Tests migrated to node:sqlite DatabaseSync
- `test/slack/adapter.test.ts` - Tests migrated to node:sqlite DatabaseSync

## Decisions Made
- **Intermediate unknown casts for query results:** node:sqlite returns `Record<string, SQLOutputValue>` from `get()` and `all()` methods. TypeScript requires `as unknown as RowType` rather than direct casts because the generic Record doesn't overlap with concrete row interfaces.
- **Number() wrapper for changes field:** node:sqlite's `StatementResultingChanges.changes` is typed as `number | bigint`. Wrapped in `Number()` for safe comparison with `> 0`.
- **noExternal regex pattern:** Used `/^(?!node:)/` negative lookahead to match all imports that don't start with `node:`, forcing npm packages to be bundled while keeping Node.js builtins external.
- **onSuccess post-build hook:** esbuild strips the `node:` prefix from external builtin imports in output. Most builtins work without the prefix, but `node:sqlite` is prefix-only. The onSuccess hook patches `from "sqlite"` to `from "node:sqlite"` after tsup writes files to disk.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript cast incompatibility with node:sqlite return types**
- **Found during:** Task 1 (node:sqlite migration)
- **Issue:** Direct `as EscalationRow[]` cast fails because `Record<string, SQLOutputValue>[]` lacks required properties
- **Fix:** Added intermediate `as unknown` cast: `stmt.all() as unknown as EscalationRow[]`
- **Files modified:** src/state/store.ts
- **Verification:** `pnpm run typecheck` passes with zero errors
- **Committed in:** 0431a9f (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed esbuild stripping node: prefix from node:sqlite imports**
- **Found during:** Task 2 (tsup bundling configuration)
- **Issue:** esbuild strips `node:` prefix from external imports in output. `from "sqlite"` fails at runtime (sqlite is prefix-only).
- **Fix:** Added `onSuccess` hook that recursively patches dist/ .js files, replacing `from "sqlite"` with `from "node:sqlite"`
- **Files modified:** tsup.config.ts
- **Verification:** `grep 'from "node:sqlite"' dist/chunk-*.js` confirms prefix preserved
- **Committed in:** cf0b394 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes necessary for correctness. The type cast issue is inherent to node:sqlite's generic return types. The esbuild prefix stripping is a known platform behavior requiring a post-build workaround.

## Issues Encountered
- esbuild's `write: false` mode (used by tsup) means esbuild plugins' `onEnd` hooks run before files are written to disk. Had to use tsup's `onSuccess` callback instead of an esbuild plugin for the sqlite import patching.
- tsup's `noExternal` takes precedence over `external` in resolution order, preventing the use of explicit `external: ['node:sqlite']` alongside `noExternal: [/.*/]`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All source files use node:sqlite -- no native addon dependencies remain
- tsup produces fully self-contained dist/ with correct output paths
- Ready for Plan 02 (plugin manifest and distribution packaging)

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 07-plugin-packaging*
*Completed: 2026-02-19*
