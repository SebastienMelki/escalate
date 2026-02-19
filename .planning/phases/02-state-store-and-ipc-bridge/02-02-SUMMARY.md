---
phase: 02-state-store-and-ipc-bridge
plan: 02
subsystem: ipc
tags: [mcp-server, http-bridge, stdio, localhost-http, node-http, tsup, plugin-config]

# Dependency graph
requires:
  - phase: 02-state-store-and-ipc-bridge
    plan: 01
    provides: "EscalationStore class, SQLite schema, FallbackAction types"
  - phase: 01-foundation
    provides: "Config schema (Zod), project tooling (tsup, vitest, eslint, prettier)"
provides:
  - "MCP server with stdio transport and 4 escalation tools (create, get, resolve, list)"
  - "HTTP bridge server on localhost for hook script escalation CRUD"
  - "Server entrypoint wiring MCP + HTTP + SQLite with port file discovery"
  - ".mcp.json plugin configuration for Claude Code"
  - "Dual tsup entry points (library + server) with better-sqlite3 external"
affects: [03-slack-adapter, 04-hook-scripts, 07-packaging]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk"]
  patterns: [mcp-tool-registration, localhost-http-bridge, port-file-discovery, main-module-guard]

key-files:
  created:
    - src/server/mcp-server.ts
    - src/server/http-bridge.ts
    - src/server/index.ts
    - .mcp.json
    - test/server/http-bridge.test.ts
  modified:
    - tsup.config.ts
    - src/index.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "MCP tool callbacks are synchronous (store API is sync) -- no async/await needed"
  - "HTTP bridge uses Node.js http.createServer directly, no framework needed for 3 routes"
  - "Auto-start guard uses fileURLToPath + process.argv[1] to prevent server launch on library import"
  - "Port file written synchronously before accepting connections for race-free discovery"

patterns-established:
  - "MCP tool registration: registerTool() with zod inputSchema and typed callback"
  - "HTTP JSON API pattern: parseJsonBody + sendJson helpers for minimal boilerplate"
  - "Port file discovery: server writes port to .claude/escalate-port, hook scripts read it"
  - "Main module guard: isMainModule check prevents side effects when imported as library"

requirements-completed: [PLAT-01, IPC-01, IPC-03]

# Metrics
duration: 5min
completed: 2026-02-19
---

# Phase 02 Plan 02: MCP Server & HTTP Bridge Summary

**MCP server with stdio transport registering 4 escalation tools plus localhost HTTP bridge for hook script POST/GET communication, wired to SQLite state store**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-19T09:30:22Z
- **Completed:** 2026-02-19T09:36:06Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- MCP server registers create_escalation, get_escalation, resolve_escalation, list_pending tools backed by EscalationStore
- HTTP bridge accepts POST /escalations (create) and GET /escalations/:id (poll) on 127.0.0.1
- Server entrypoint orchestrates MCP stdio + HTTP bridge + SQLite lifecycle with port file discovery
- .mcp.json configures the MCP server for Claude Code plugin with CLAUDE_PROJECT_DIR passthrough
- 7 HTTP bridge integration tests passing with in-memory SQLite
- All quality gates pass: 43 tests, typecheck, build (dual entry), lint, format

## Task Commits

Each task was committed atomically:

1. **Task 1: MCP server with stdio transport and escalation tools** - `5c2a238` (feat)
2. **Task 2: HTTP bridge, server entrypoint, plugin config, and tests** - `491c3b4` (feat)

## Files Created/Modified
- `src/server/mcp-server.ts` - MCP server with 4 escalation tools (create, get, resolve, list)
- `src/server/http-bridge.ts` - HTTP bridge with POST /escalations, GET /escalations/:id, GET /health
- `src/server/index.ts` - Server entrypoint wiring MCP + HTTP + SQLite with port file and signal handling
- `.mcp.json` - MCP server configuration for Claude Code plugin
- `test/server/http-bridge.test.ts` - 7 integration tests for HTTP bridge routes
- `tsup.config.ts` - Added server entry point, marked better-sqlite3 as external
- `src/index.ts` - Added server module re-exports (createMcpServer, createHttpBridge, startServer)
- `package.json` - Added @modelcontextprotocol/sdk dependency
- `pnpm-lock.yaml` - Updated lockfile with MCP SDK and transitive dependencies

## Decisions Made
- MCP tool callbacks are synchronous because the EscalationStore API is sync (better-sqlite3). The MCP SDK ToolCallback type accepts both sync and async returns.
- HTTP bridge uses raw Node.js http.createServer -- no Express/Hono framework needed for 3 simple JSON routes on localhost.
- Auto-start guard compares fileURLToPath(import.meta.url) with process.argv[1] to prevent the server from launching when src/index.ts barrel imports it as a library.
- Port file is written synchronously inside the listen callback, before the event loop continues, ensuring hook scripts cannot read a stale or missing port file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Guarded auto-start to prevent side effects on library import**
- **Found during:** Task 2 (server entrypoint implementation)
- **Issue:** The server entrypoint had unconditional auto-start and signal handler registration at module scope, which would execute when imported via the library barrel (src/index.ts)
- **Fix:** Added isMainModule guard using fileURLToPath comparison to only auto-start when run directly
- **Files modified:** src/server/index.ts
- **Verification:** Library imports do not trigger server startup; build produces clean output
- **Committed in:** 491c3b4

**2. [Rule 1 - Bug] Fixed 11 ESLint violations across server files**
- **Found during:** Task 2 (verification)
- **Issue:** Lint errors: async functions without await (MCP callbacks), no-misused-promises on createServer/signal handlers, restrict-template-expressions on number/undefined types, use-unknown-in-catch-callback-variable
- **Fix:** Removed unnecessary async from MCP tool callbacks, extracted async handler for HTTP bridge, used void-then pattern for signal handlers, added String() conversions for template literals, typed catch variable as unknown
- **Files modified:** src/server/mcp-server.ts, src/server/http-bridge.ts, src/server/index.ts, test/server/http-bridge.test.ts
- **Verification:** `pnpm run lint` passes with zero errors
- **Committed in:** 491c3b4

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- @modelcontextprotocol/sdk was not yet installed -- added as runtime dependency before Task 1.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- MCP server and HTTP bridge are ready for the Slack adapter (Phase 3) to resolve escalations via the store
- Hook scripts (Phase 4) can POST to the HTTP bridge to create escalations and GET to poll for responses
- Port file discovery pattern established for hook-to-server communication
- Full lifecycle test coverage: create -> get -> resolve -> get-resolved confirmed working

## Self-Check: PASSED
