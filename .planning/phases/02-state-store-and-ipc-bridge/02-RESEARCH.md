# Phase 2: State Store and IPC Bridge - Research

**Researched:** 2026-02-19
**Domain:** SQLite state store + MCP server with HTTP bridge for hook-to-server IPC
**Confidence:** HIGH

## Summary

Phase 2 establishes the inter-process communication backbone between hook scripts (short-lived, spawned per event) and the MCP server (long-lived, one per session). The MCP server runs as a stdio process owned by Claude Code while simultaneously exposing an HTTP endpoint on localhost for hook scripts to POST escalations and GET responses. SQLite in WAL mode serves as the durable state store, bridging the process boundary: the MCP server writes resolved responses, and hook scripts poll for them.

The architecture is straightforward: one Node.js process, two communication channels (stdio for MCP protocol, HTTP for hooks), one SQLite database. The primary risks are port discovery (how hook scripts learn the HTTP port), better-sqlite3 native binding management during bundling, and ensuring the experimental `node:sqlite` is NOT used (despite convenience) because its API is not yet stable.

**Primary recommendation:** Use `better-sqlite3` 12.x for the state store, Node.js `http.createServer` for the HTTP bridge (no framework needed), and `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport` for the MCP server. Mark `better-sqlite3` as external in tsup config. Use a port file at `$CLAUDE_PROJECT_DIR/.claude/escalate-port` for hook-to-server port discovery.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAT-01 | MCP server runs with stdio transport as Claude Code plugin process | MCP SDK `McpServer` + `StdioServerTransport` verified in cached SDK source; `.mcp.json` config pattern documented in plugin-dev skill; process lifecycle: spawned at plugin load, runs for session, terminated on exit |
| IPC-01 | MCP server exposes local HTTP bridge endpoint for hook script communication (separate from stdio MCP protocol) | Node.js `http.createServer` runs alongside stdio transport in same process event loop; verified experimentally that HTTP server + stdio coexist; port discovery via port file pattern |
| IPC-02 | SQLite state store (better-sqlite3) tracks pending escalations by correlation ID with timestamps | `better-sqlite3` 12.6.2 synchronous API: `.prepare()`, `.run()`, `.get()`, `.all()`; WAL mode for concurrent read+write; STRICT tables for type safety; verified compatible with Node 22.x |
| IPC-03 | Hook scripts poll SQLite for user response with configurable timeout (default 10 minutes for PermissionRequest) | Direct SQLite polling pattern: hook opens read-only connection, runs `SELECT` in loop with sleep; alternatively poll HTTP endpoint on MCP server; timeout from config `DEFAULT_TIMEOUTS.permissionRequest` (600_000ms) already defined in Phase 1 |
| IPC-05 | Graceful timeout with configurable fallback decision per event type (allow, deny, or ask-again) | Fallback decision type extends existing config schema; timeout returns fallback as PermissionRequest hook output format: `hookSpecificOutput.decision.behavior` = `"allow"` or `"deny"` |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.26.0 | MCP server (McpServer + StdioServerTransport) | Official Anthropic SDK; ESM-native; provides high-level `McpServer` class with `registerTool()` API; peer dep on zod ^3.25 or ^4.0 (project already has zod 4.3.6) |
| `better-sqlite3` | 12.6.2 | SQLite state store | Synchronous API fits polling pattern; WAL mode for concurrent access; 12.x supports Node 20.x/22.x; well-tested, stable, widely used |
| `@types/better-sqlite3` | 7.6.13 | TypeScript types for better-sqlite3 | Dev dependency; provides Database, Statement, Transaction types |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `http` module | built-in | HTTP bridge server | Always -- zero-dependency HTTP endpoint alongside MCP stdio; no Express/Hono needed for this simple use case |
| Node.js `crypto` module | built-in | Correlation ID generation | `crypto.randomUUID()` for unique escalation IDs |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `better-sqlite3` | `node:sqlite` (built-in) | `node:sqlite` is Stability 1.1 (Active Development) -- API may change; no `--experimental-sqlite` flag needed since Node 22.13.0, but still emits warning; `better-sqlite3` is battle-tested with identical sync API |
| `better-sqlite3` | File-based JSON IPC | Fragile under concurrent access; no WAL; no atomic writes; SQLite handles all edge cases |
| `http.createServer` | Express 5 / Hono | Unnecessary weight for 3-4 routes; adds dependency; `http.createServer` is sufficient for JSON API on localhost |
| TCP port | Unix domain socket | Socket avoids port conflicts but complicates Windows support and is harder to test with curl; port file pattern is simpler |
| Port file | Fixed env var port | Fixed port risks conflicts; port file allows dynamic binding to port 0 then advertising |

**Installation:**
```bash
# Runtime dependencies
pnpm add @modelcontextprotocol/sdk better-sqlite3

# Dev dependencies
pnpm add -D @types/better-sqlite3
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── server/
│   ├── mcp-server.ts        # McpServer setup, tool registration, stdio transport
│   ├── http-bridge.ts        # HTTP server for hook communication (POST/GET/health)
│   └── index.ts              # Entrypoint: starts MCP + HTTP, connects to state store
├── state/
│   ├── store.ts              # SQLite operations: create, resolve, get, timeout escalations
│   ├── schema.ts             # Table DDL, migration logic
│   └── types.ts              # Escalation record types (PendingEscalation, ResolvedEscalation)
├── config/                   # (existing from Phase 1)
├── types/                    # (existing from Phase 1)
├── errors/                   # (existing from Phase 1)
└── index.ts                  # (existing from Phase 1, updated barrel)
```

### Pattern 1: MCP Server with Sidecar HTTP Bridge

**What:** A single Node.js process runs both the MCP stdio transport (for Claude Code) and an HTTP server (for hook scripts). They share the same event loop and in-memory state.

**When to use:** Always in this project. The MCP server is the single long-lived process that owns all state.

**Example:**
```typescript
// Source: verified from MCP SDK cached source + Node.js http docs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'node:http';

// MCP server for Claude Code (stdio)
const mcpServer = new McpServer(
  { name: 'escalate', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// Register MCP tools
mcpServer.registerTool('create_escalation', {
  description: 'Create a new escalation request',
  inputSchema: { /* zod schema */ },
}, async (args) => {
  // ... create in SQLite, return correlation ID
});

// HTTP bridge for hook scripts (localhost only)
const httpServer = createServer((req, res) => {
  // POST /escalations - create
  // GET /escalations/:id - poll for response
  // GET /health - health check
});

// Start both
const transport = new StdioServerTransport();
await mcpServer.connect(transport);
httpServer.listen(port, '127.0.0.1');
```

### Pattern 2: SQLite State Store with WAL Mode

**What:** A SQLite database in WAL (Write-Ahead Logging) mode allows concurrent readers (hook scripts polling) and one writer (MCP server resolving escalations). The database file lives at a known project-local path.

**When to use:** Always. WAL mode is essential for the polling pattern.

**Example:**
```typescript
// Source: better-sqlite3 API docs (https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
import Database from 'better-sqlite3';

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    event_type TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT,
    fallback_action TEXT NOT NULL DEFAULT 'deny',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    timeout_at TEXT NOT NULL
  ) STRICT
`);

// Create pending escalation
const createStmt = db.prepare(`
  INSERT INTO escalations (id, event_type, request_json, fallback_action, timeout_at)
  VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
`);

// Poll for resolution
const getStmt = db.prepare(`
  SELECT * FROM escalations WHERE id = ?
`);

// Resolve escalation (MCP server writes response)
const resolveStmt = db.prepare(`
  UPDATE escalations
  SET status = 'resolved', response_json = ?, resolved_at = datetime('now')
  WHERE id = ? AND status = 'pending'
`);
```

### Pattern 3: Port File Discovery

**What:** The MCP server binds to a dynamic port (or configured port), then writes the port number to a known file path. Hook scripts read this file to discover the HTTP bridge endpoint.

**When to use:** Always. This is how hook scripts find the MCP server's HTTP bridge.

**Example:**
```typescript
// MCP server writes port file on startup
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
const portFilePath = join(projectDir, '.claude', 'escalate-port');

httpServer.listen(0, '127.0.0.1', () => {
  const addr = httpServer.address();
  if (addr && typeof addr === 'object') {
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    writeFileSync(portFilePath, String(addr.port), 'utf-8');
  }
});

// Hook script reads port file
// (In hook script, not MCP server)
const port = readFileSync(portFilePath, 'utf-8').trim();
const response = await fetch(`http://127.0.0.1:${port}/escalations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(escalationRequest),
});
```

### Pattern 4: Hook Script Polling via HTTP

**What:** Hook scripts POST to the HTTP bridge to create an escalation, then poll GET until the escalation is resolved or timeout expires. The hook script blocks (which is intentional -- Claude Code waits for the exit code).

**When to use:** For PermissionRequest and PreToolUse hooks that need a human decision.

**Example:**
```typescript
// Hook script polling pattern (simplified)
async function waitForDecision(
  bridgeUrl: string,
  escalationId: string,
  timeoutMs: number,
): Promise<{ behavior: 'allow' | 'deny'; message?: string }> {
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 2000;

  while (Date.now() < deadline) {
    const res = await fetch(`${bridgeUrl}/escalations/${escalationId}`);
    const data = await res.json();

    if (data.status === 'resolved') {
      return data.response;
    }
    if (data.status === 'timed_out') {
      return { behavior: data.fallbackAction };
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  // Local timeout (shouldn't reach here if server-side timeout works)
  return { behavior: 'deny' };
}
```

### Anti-Patterns to Avoid

- **Writing to stdout in MCP server process:** MCP stdio transport owns stdout. Any stray `console.log()` corrupts the JSON-RPC protocol. Use `stderr` for logging or `server.sendLoggingMessage()` for in-band MCP logging.

- **Hook scripts importing MCP SDK:** Hook scripts are short-lived subprocesses. They should NOT import `@modelcontextprotocol/sdk` or any heavy dependencies. They use `fetch()` (built-in Node 22) to talk to the HTTP bridge.

- **Opening SQLite in write mode from hook scripts:** Only the MCP server process should write to SQLite. Hook scripts can read (for polling) but should prefer the HTTP bridge API. Multiple writers risk SQLITE_BUSY even with WAL.

- **Using `node:sqlite` for production code:** It's Stability 1.1, API may change between Node versions. `better-sqlite3` has an identical sync API and is stable.

- **Fixed port without fallback:** Don't hardcode port 7842. Use port 0 (dynamic) + port file, or a configurable env var with port 0 as default.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite database access | Custom file-based JSON store | `better-sqlite3` | Handles concurrent access, WAL mode, atomic transactions, crash recovery |
| MCP server protocol | Custom JSON-RPC over stdio | `@modelcontextprotocol/sdk` McpServer | Protocol is complex (JSON-RPC 2.0 + MCP extensions); SDK handles framing, validation, tool registration |
| UUID generation | Custom ID generators | `crypto.randomUUID()` | Built-in, RFC 4122 compliant, cryptographically random |
| HTTP request parsing | Manual Buffer/stream concatenation | Node.js `http.IncomingMessage` with `await` pattern | Simple JSON body parsing for the 3 routes needed |

**Key insight:** The HTTP bridge is intentionally simple (3-4 routes, JSON only, localhost only). A framework would add more complexity than it removes. The MCP server protocol, however, is complex enough to justify the SDK.

## Common Pitfalls

### Pitfall 1: Port Discovery Race Condition

**What goes wrong:** Hook script runs before the MCP server has written its port file, causing ENOENT or empty file read.
**Why it happens:** Claude Code may fire SessionStart hooks before or concurrently with MCP server startup. The MCP server needs time to bind and write.
**How to avoid:** Hook scripts should retry port file reads with a short backoff (e.g., 3 attempts, 500ms apart). The HTTP bridge should write the port file synchronously before accepting connections. Consider also supporting a configurable `ESCALATE_HTTP_PORT` env var as override (skips port file).
**Warning signs:** Hook scripts failing with "connection refused" or "ENOENT" on first session event.

### Pitfall 2: better-sqlite3 Native Binding in tsup Bundle

**What goes wrong:** tsup/esbuild bundles `better-sqlite3` but can't bundle the `.node` native addon, breaking the import at runtime.
**Why it happens:** `better-sqlite3` is a native C++ addon using `bindings` to locate `better_sqlite3.node`. Bundlers relocate JS files but leave the native binary behind, breaking the path resolution.
**How to avoid:** Mark `better-sqlite3` as `external` in `tsup.config.ts`. The native module must remain in `node_modules/` at runtime. For plugin distribution (Phase 7), this means the plugin install step must include `npm install better-sqlite3` or prebuild binaries must be shipped alongside.
**Warning signs:** `Error: Could not locate the bindings file` or `MODULE_NOT_FOUND` at runtime after build.

### Pitfall 3: stdout Pollution in MCP Server Process

**What goes wrong:** Any output to stdout that isn't valid MCP JSON-RPC breaks the protocol. Claude Code disconnects from the MCP server.
**Why it happens:** `console.log()` in server code, library startup messages, or Node.js warnings write to stdout.
**How to avoid:** Never use `console.log()` in the MCP server entry point or any code it imports. Use `console.error()` (stderr) for debug output. Suppress Node.js warnings with `--no-warnings` flag in `.mcp.json` args. Use `server.sendLoggingMessage()` for in-band MCP logging.
**Warning signs:** MCP server disconnects immediately after startup; `claude --debug` shows "JSON parse error" from MCP server.

### Pitfall 4: SQLite Database Location

**What goes wrong:** Database file is created in the wrong directory, or in a location that doesn't survive between sessions, or conflicts between projects.
**Why it happens:** Using `process.cwd()` which varies, or a temp directory that gets cleaned up.
**How to avoid:** Store the database at `$CLAUDE_PROJECT_DIR/.claude/escalate.db`. This is project-scoped (no cross-project conflicts), persists between sessions (for audit trail), and lives in `.claude/` which is conventionally gitignored.
**Warning signs:** Escalation state lost between sessions; database file appears in unexpected location; git tracking the `.db` file.

### Pitfall 5: Hook Timeout vs Polling Timeout Mismatch

**What goes wrong:** The hook script's polling timeout exceeds Claude Code's hook execution timeout (default 600s for command hooks), causing Claude Code to kill the hook before it can return a decision.
**Why it happens:** Hook polling timeout and Claude Code's hook timeout are configured independently.
**How to avoid:** The hook script's polling timeout must be less than Claude Code's hook `timeout` field. Leave a safety margin (e.g., if hook timeout is 600s, poll for 590s max). The escalation timeout in config should be validated against the hook timeout.
**Warning signs:** Hook processes killed by SIGTERM; escalations showing as timed out on both sides.

### Pitfall 6: Fallback Decision Schema Mismatch

**What goes wrong:** The fallback decision (allow/deny/ask-again) doesn't match the expected hook output format for the event type.
**Why it happens:** PermissionRequest hooks expect `hookSpecificOutput.decision.behavior` = `"allow"|"deny"`, while PreToolUse hooks expect `hookSpecificOutput.permissionDecision` = `"allow"|"deny"|"ask"`. Different events have different output schemas.
**How to avoid:** The state store should record the event type alongside the fallback action. The HTTP bridge response must be formatted correctly for each event type. Consider a small adapter layer that translates generic "allow/deny" into the correct hook output format per event type.
**Warning signs:** Claude Code ignoring hook decisions; hooks appearing to succeed but not having the expected effect.

## Code Examples

Verified patterns from official sources:

### MCP Server with Tool Registration

```typescript
// Source: MCP SDK cached source (dist/esm/server/mcp.d.ts)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'escalate', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// Register a tool with zod input schema
server.registerTool('create_escalation', {
  description: 'Create a pending escalation for a hook event',
  inputSchema: {
    event_type: z.string(),
    title: z.string(),
    question: z.string(),
    urgency: z.enum(['info', 'warning', 'critical']),
    timeout_seconds: z.number().optional(),
  },
}, async (args, extra) => {
  const id = crypto.randomUUID();
  // ... create in state store
  return {
    content: [{ type: 'text', text: JSON.stringify({ escalation_id: id }) }],
  };
});

// Connect to stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### better-sqlite3 Database Setup

```typescript
// Source: better-sqlite3 API docs (https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

function openDatabase(dbPath: string): DatabaseType {
  const db = new Database(dbPath);

  // WAL mode: readers don't block writers, writer doesn't block readers
  db.pragma('journal_mode = WAL');

  // Wait up to 5s if database is locked (rare with WAL, but safe)
  db.pragma('busy_timeout = 5000');

  // Foreign keys for referential integrity
  db.pragma('foreign_keys = ON');

  return db;
}
```

### HTTP Bridge with JSON Body Parsing

```typescript
// Source: Node.js http module docs
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body.length > 0 ? JSON.parse(body) : undefined);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // ... other routes

  res.writeHead(404);
  res.end();
});
```

### PermissionRequest Hook Output Format

```typescript
// Source: Claude Code hooks reference (https://code.claude.com/docs/en/hooks)
// For ALLOWING a permission request:
const allowOutput = {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: {
      behavior: 'allow',
    },
  },
};

// For DENYING a permission request:
const denyOutput = {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: {
      behavior: 'deny',
      message: 'Denied by escalate: timeout expired, fallback action is deny',
    },
  },
};

// Hook script writes JSON to stdout and exits 0
process.stdout.write(JSON.stringify(allowOutput));
process.exit(0);
```

### PreToolUse Hook Output Format

```typescript
// Source: Claude Code hooks reference (https://code.claude.com/docs/en/hooks)
// For PreToolUse, the format is different from PermissionRequest:
const preToolUseAllow = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: 'Approved by escalate: user approved via Slack',
  },
};

const preToolUseDeny = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'Denied by escalate: timeout expired',
  },
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Server` (low-level MCP class) | `McpServer` (high-level) | MCP SDK 1.x | Use `McpServer` with `registerTool()` -- cleaner API, built-in validation |
| `.tool()` method (deprecated) | `.registerTool()` method | MCP SDK recent | `.tool()` still works but `.registerTool()` is the current API |
| `SSEServerTransport` | `StreamableHTTPServerTransport` | MCP SDK 1.x | SSE transport deprecated; not relevant here (we use stdio) but good to know |
| `node:sqlite` experimental flag | No flag needed (Node 22.13.0+) | Node 22.13.0 | `node:sqlite` works without `--experimental-sqlite` but remains Stability 1.1 |
| `better-sqlite3` bindings pkg | `prebuild-install` | better-sqlite3 12.x | Prebuilt binaries downloaded at install time; no C++ compiler needed |

**Deprecated/outdated:**
- `Server` class from `@modelcontextprotocol/sdk/server/index.js`: Use `McpServer` instead. SDK source explicitly says "Use McpServer instead for the high-level API."
- `SSEServerTransport`: Replaced by `StreamableHTTPServerTransport`. Not relevant for stdio plugins.
- `server.tool()`: Deprecated in favor of `server.registerTool()`. Both work, but new code should use `registerTool()`.

## Open Questions

1. **MCP server startup timing vs SessionStart hook**
   - What we know: Claude Code spawns the MCP server as a child process and fires SessionStart hooks. Both happen at session start.
   - What's unclear: The exact ordering. Does the MCP server fully initialize (including HTTP bridge port write) before SessionStart hooks fire? Or can they race?
   - Recommendation: Design for the race condition. Hook scripts retry port file reads with backoff. The HTTP bridge writes its port file synchronously before entering the event loop. Alternatively, skip SessionStart dependency entirely and have hook scripts read the port file directly (with retry).

2. **Database path when CLAUDE_PROJECT_DIR is unavailable**
   - What we know: Hook scripts get `$CLAUDE_PROJECT_DIR`. The MCP server gets only what's in `.mcp.json` env.
   - What's unclear: Whether `CLAUDE_PROJECT_DIR` is automatically available to the MCP server process, or if it must be explicitly passed via `.mcp.json` env.
   - Recommendation: Explicitly pass it in `.mcp.json`: `"CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}"`. Fall back to `process.cwd()` if unset.

3. **Concurrent escalations from parallel hooks**
   - What we know: Claude Code runs all matching hooks in parallel. Multiple hooks could fire simultaneously for the same event.
   - What's unclear: Whether two hooks for the same event (e.g., two PreToolUse matchers) can both create escalations simultaneously.
   - Recommendation: Each escalation gets a unique UUID correlation ID. SQLite handles concurrent inserts via WAL mode. The HTTP bridge handles concurrent requests via Node.js event loop. No special concurrency control needed beyond what SQLite provides.

4. **Plugin distribution with native better-sqlite3**
   - What we know: better-sqlite3 has native C++ bindings that must be compiled or use prebuild binaries. tsup cannot bundle native modules.
   - What's unclear: How Phase 7 (Plugin Packaging) will handle distributing better-sqlite3 prebuild binaries for multiple platforms.
   - Recommendation: Defer to Phase 7. For now, mark as `external` in tsup config. Phase 7 research will address distribution strategies (e.g., `optionalDependencies`, postinstall scripts, or `node:sqlite` migration if it reaches Stability 2 by then).

## Sources

### Primary (HIGH confidence)
- MCP SDK cached source at `~/.npm/_npx/5a9d879542beca3a/node_modules/@modelcontextprotocol/sdk/dist/esm/server/` -- verified `McpServer`, `StdioServerTransport`, `registerTool()` API, tool callback signature
- `npm show @modelcontextprotocol/sdk --json` -- version 1.26.0, peer deps: `zod ^3.25 || ^4.0`, engines: `node>=18`
- `npm show better-sqlite3 --json` -- version 12.6.2, engines: `node 20.x || 22.x || 23.x || 24.x || 25.x`
- better-sqlite3 API docs (fetched via WebFetch): https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md -- constructor, prepare, run, get, all, WAL pragma, transaction, busy_timeout
- Claude Code hooks reference (fetched via WebFetch): https://code.claude.com/docs/en/hooks -- PermissionRequest input/output format, PreToolUse hookSpecificOutput, exit codes, JSON output schema, hook handler fields
- Plugin-dev hook-development skill at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/SKILL.md` -- hook configuration format, environment variables ($CLAUDE_PLUGIN_ROOT, $CLAUDE_PROJECT_DIR, $CLAUDE_ENV_FILE), hook events, exit codes
- Plugin-dev mcp-integration skill at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/mcp-integration/SKILL.md` -- .mcp.json configuration, stdio transport, env variable expansion, tool naming format
- Node.js sqlite docs (fetched via WebFetch): https://nodejs.org/docs/latest-v22.x/api/sqlite.html -- Stability 1.1 (Active Development), no flag needed since v22.13.0, DatabaseSync API

### Secondary (MEDIUM confidence)
- SQLite WAL mode concurrency (WebSearch verified with official SQLite docs): https://sqlite.org/wal.html -- readers don't block writers, one writer at a time, concurrent reads
- esbuild/tsup native module bundling (WebSearch + esbuild issue): https://github.com/evanw/esbuild/issues/2830 -- native modules must be external, cannot bundle .node files

### Tertiary (LOW confidence)
- None -- all findings verified with primary or secondary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified via npm registry; API verified from cached SDK source and official docs
- Architecture: HIGH -- MCP stdio + HTTP sidecar pattern verified experimentally; hook output formats verified from official Claude Code documentation
- Pitfalls: HIGH -- native binding bundling issue well-documented in esbuild issues; stdout pollution documented in Claude Code plugin guides; SQLite WAL concurrency documented in SQLite official docs

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (30 days -- stable domain, all libraries are established)
