# Phase 7: Plugin Packaging - Research

**Researched:** 2026-02-19
**Domain:** tsup bundling, Claude Code plugin packaging, native module elimination, self-contained distribution
**Confidence:** HIGH

## Summary

Phase 7 transforms the Escalate project from a development workspace into a self-contained, installable Claude Code plugin. Two interrelated problems must be solved: (1) bundling all runtime dependencies into `dist/` so no `node_modules` is needed post-install, and (2) ensuring all plugin manifest paths (`plugin.json`, `.mcp.json`, `hooks.json`) use `${CLAUDE_PLUGIN_ROOT}` and resolve correctly after installation to the plugin cache at `~/.claude/plugins/cache/`.

The central tension is `better-sqlite3`, which is a C++ native addon (`.node` file) that cannot be bundled by esbuild/tsup. Fortunately, Node.js 22+ ships a built-in `node:sqlite` module with a nearly identical synchronous API. Since the project already targets `node >= 22.0.0`, migrating from `better-sqlite3` to `node:sqlite` eliminates the only native dependency, making `noExternal: [/(.*)/]` viable for full bundling. The remaining dependencies (`@modelcontextprotocol/sdk`, `@slack/bolt`, `openai`, `zod`) are pure JavaScript and can be bundled without issues.

A secondary bug exists in the current tsup configuration: entry points specified as a string array cause tsup to preserve source directory structure in output (`src/server/index.ts` becomes `dist/src/server/index.js`), but `.mcp.json` references `dist/server/index.js`. This is fixed by switching to the object entry format where keys control output paths.

**Primary recommendation:** Migrate `better-sqlite3` to `node:sqlite` (built-in), switch tsup to `noExternal: [/(.*)/]` for full bundling, fix entry point paths with object entry format, and update `plugin.json` with complete metadata. Two plans: (1) migrate SQLite and update tsup config, (2) finalize plugin manifest and validate end-to-end.

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAT-04 | Plugin packaged as Claude Code plugin -- plugin.json manifest, hooks.json, .mcp.json with ${CLAUDE_PLUGIN_ROOT} paths | hooks.json and .mcp.json already use ${CLAUDE_PLUGIN_ROOT}. plugin.json needs metadata fields. Entry point path mismatch must be fixed (dist/src/server vs dist/server). |
| PLAT-05 | All output bundled with tsup for self-contained distribution (no npm install needed post-install) | Requires: (a) migrate better-sqlite3 to node:sqlite to eliminate native addon, (b) set noExternal: [/(.*)/] to bundle all deps, (c) switch entry format to object for correct output paths. |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsup | 8.5.1 | TypeScript bundler (already in project) | esbuild-powered, ESM output, code splitting, handles CJS-to-ESM conversion |
| node:sqlite | built-in (Node 22+) | SQLite database (replaces better-sqlite3) | Zero dependencies, no native addon, sync API compatible with better-sqlite3 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | 1.26.0 | MCP server protocol (already a dependency) | Bundled into dist/ via noExternal |
| @slack/bolt | 4.6.0 | Slack Socket Mode (already a dependency) | Bundled into dist/ via noExternal -- CJS, esbuild handles conversion |
| openai | 6.22.0 | Whisper transcription (already a dependency) | Bundled into dist/ via noExternal -- zero transitive deps |
| zod | 4.3.6 | Schema validation (already a dependency) | Bundled into dist/ via noExternal -- pure ESM |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:sqlite (built-in) | Keep better-sqlite3 + ship node_modules | Keeps native addon, requires platform-specific builds, breaks "no npm install" requirement |
| node:sqlite (built-in) | sql.js (Emscripten WASM build) | Pure JS, but 2MB+ WASM blob, significantly slower, more complex API |
| noExternal: [/(.*)/] | Keep external deps + postinstall script | Would need npm install after plugin cache copy -- violates PLAT-05 |

**Installation:**
```bash
# No new packages needed. Remove better-sqlite3 and @types/better-sqlite3:
pnpm remove better-sqlite3 @types/better-sqlite3
```

## Architecture Patterns

### Recommended Project Structure (post-packaging)

```
escalate/
├── .claude-plugin/
│   └── plugin.json            # Full metadata (name, version, description, author, etc.)
├── hooks/
│   └── hooks.json             # Already uses ${CLAUDE_PLUGIN_ROOT}/dist/scripts/...
├── .mcp.json                  # Already uses ${CLAUDE_PLUGIN_ROOT}/dist/server/index.js
├── dist/                      # Self-contained bundle (committed or built on release)
│   ├── index.js               # Library entry point (re-exports)
│   ├── server/
│   │   └── index.js           # MCP server entry (auto-starts on direct execution)
│   ├── scripts/
│   │   ├── on-permission-request.js
│   │   ├── on-pre-tool-use.js
│   │   ├── on-stop.js
│   │   ├── on-post-tool-failure.js
│   │   ├── on-task-completed.js
│   │   └── lib/
│   │       └── bridge-client.js
│   └── chunk-*.js             # Shared code chunks (auto-generated by tsup splitting)
├── src/                       # Source (not shipped)
├── test/                      # Tests (not shipped)
└── ...
```

### Pattern 1: Object Entry Format for Controlled Output Paths

**What:** Use tsup's object entry syntax to map desired output paths to source files.
**When to use:** When entry points span multiple source directories (src/, scripts/) and output paths must match manifest references.
**Example:**
```typescript
// tsup.config.ts
// Source: https://github.com/egoist/tsup/issues/447
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'server/index': 'src/server/index.ts',
    'scripts/on-permission-request': 'scripts/on-permission-request.ts',
    'scripts/on-pre-tool-use': 'scripts/on-pre-tool-use.ts',
    'scripts/on-stop': 'scripts/on-stop.ts',
    'scripts/on-post-tool-failure': 'scripts/on-post-tool-failure.ts',
    'scripts/on-task-completed': 'scripts/on-task-completed.ts',
    'scripts/lib/bridge-client': 'scripts/lib/bridge-client.ts',
  },
  format: ['esm'],
  noExternal: [/(.*)/],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
});
```

### Pattern 2: node:sqlite Migration (better-sqlite3 to built-in)

**What:** Replace `better-sqlite3` with `node:sqlite` (DatabaseSync).
**When to use:** When targeting Node.js 22+ and need to eliminate native addon.
**Example:**
```typescript
// Before (better-sqlite3):
import Database from 'better-sqlite3';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
const stmt = db.prepare('SELECT * FROM t WHERE id = ?');
const row = stmt.get(id) as Row | undefined;
const result = stmt.run(val1, val2);
// result.changes is number

// After (node:sqlite):
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');
const stmt = db.prepare('SELECT * FROM t WHERE id = ?');
const row = stmt.get(id) as Row | undefined;
const result = stmt.run(val1, val2);
// result.changes is number | bigint
```

### Pattern 3: Full Dependency Bundling

**What:** Set `noExternal: [/(.*)/]` to bundle ALL npm dependencies into the output.
**When to use:** For self-contained distribution where `node_modules` should not exist at runtime.
**Example:**
```typescript
// tsup.config.ts
// Source: https://github.com/egoist/tsup/issues/619
export default defineConfig({
  noExternal: [/(.*)/],  // Bundle everything
  // No 'external' array needed
});
```

### Anti-Patterns to Avoid

- **Keeping better-sqlite3 and trying to ship its .node binary:** The native addon is platform-specific (arm64 vs x64, macOS vs Linux). Shipping it means platform-specific builds, which is impractical for a plugin.
- **Using postinstall scripts in the plugin:** Claude Code plugin cache copies the directory. There is no npm install step after caching. A postinstall script would never run for installed plugins.
- **Hardcoding absolute paths in hooks/MCP config:** Always use `${CLAUDE_PLUGIN_ROOT}`. Plugins get cached to `~/.claude/plugins/cache/` where paths differ from development.
- **Committing node_modules to the plugin:** This is never needed if noExternal bundles everything. It would bloat the plugin and include platform-specific binaries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite binding | Custom FFI/WASM wrapper | node:sqlite (built-in) | Battle-tested, maintained by Node.js core, zero deps |
| Dependency bundling | Custom build script | tsup with noExternal | Handles CJS-to-ESM, tree shaking, code splitting, source maps |
| Plugin path resolution | Hard-coded path logic | ${CLAUDE_PLUGIN_ROOT} env var | Claude Code resolves this automatically at plugin load time |
| Version management | Manual version tracking | Semver in plugin.json | Claude Code uses this for update detection |

**Key insight:** The entire packaging phase is about configuration, not code. The bundler and plugin system already exist -- the work is wiring them correctly and eliminating the one dependency (better-sqlite3) that prevents full bundling.

## Common Pitfalls

### Pitfall 1: tsup Output Path Mismatch with Plugin Manifests

**What goes wrong:** Entry points as string arrays (`['src/server/index.ts']`) produce output at `dist/src/server/index.js`, but `.mcp.json` references `${CLAUDE_PLUGIN_ROOT}/dist/server/index.js`. The MCP server fails to start.
**Why it happens:** When entry points span different source directories, tsup/esbuild computes a common base directory and preserves the relative path structure. With `src/index.ts` and `scripts/on-stop.ts`, the common base is the project root, so `src/` prefix is preserved.
**How to avoid:** Use object entry format: `entry: { 'server/index': 'src/server/index.ts' }`.
**Warning signs:** `.mcp.json` path does not match `ls dist/` output.

### Pitfall 2: node:sqlite ExperimentalWarning on stderr

**What goes wrong:** `node:sqlite` emits an ExperimentalWarning to stderr on first import. Since the MCP server uses stdio, stderr is the debug/log channel (not stdout), so this is harmless but noisy.
**Why it happens:** `node:sqlite` stability level is 1.1 (Active Development) as of Node.js 25, and 1.0 (Experimental) in Node 22.
**How to avoid:** Suppress with `--no-warnings=ExperimentalWarning` in the MCP server command, or accept the warning on stderr (it does not affect functionality).
**Warning signs:** `(node:XXXX) ExperimentalWarning: SQLite is an experimental feature` in stderr logs.

### Pitfall 3: CJS Dependencies in ESM Bundle

**What goes wrong:** Some bundled dependencies (express, @slack/bolt, @slack/web-api) are CommonJS. When bundled into an ESM output, esbuild must convert them. Rarely, CJS modules with dynamic `require()` calls or `__dirname` usage can fail.
**Why it happens:** CJS-to-ESM conversion is imperfect for edge cases (circular requires, dynamic requires, `module.exports` mutations).
**How to avoid:** Test the bundled output by actually running it (`node dist/server/index.js`). If a specific CJS module fails, mark only that module as `external` and document it.
**Warning signs:** Runtime errors like "require is not defined" or "__dirname is not defined" in the bundled output.

### Pitfall 4: node:sqlite API Differences from better-sqlite3

**What goes wrong:** Code assumes better-sqlite3 API and breaks with node:sqlite.
**Why it happens:** Several API differences exist:
- `db.pragma()` does not exist in node:sqlite -- use `db.exec('PRAGMA ...')` instead
- Type signature: `import type Database from 'better-sqlite3'` becomes `import { DatabaseSync } from 'node:sqlite'`
- Statement type: `Database.Statement` becomes `StatementSync`
- `result.changes` is `number | bigint` in node:sqlite vs `number` in better-sqlite3
- Constructor: `new Database(path)` becomes `new DatabaseSync(path)`
- `db.pragma('foreign_keys = ON')` becomes `db.exec('PRAGMA foreign_keys = ON')` or use `enableForeignKeyConstraints: true` constructor option
**How to avoid:** Update each usage site systematically. The store uses only `.prepare()`, `.run()`, `.get()`, `.all()`, `.exec()`, and `.pragma()` -- all have direct equivalents.
**Warning signs:** TypeScript compilation errors after changing imports.

### Pitfall 5: Plugin Cache Path Traversal

**What goes wrong:** Plugin references files outside its root directory using `../` paths. After installation to the plugin cache (`~/.claude/plugins/cache/`), these paths break because external files are not copied.
**Why it happens:** During development with `--plugin-dir .`, relative paths work because the full filesystem is accessible. After installation, only the plugin directory tree is cached.
**How to avoid:** Keep all referenced files inside the plugin root. If external files are needed, create symlinks (honored during cache copy).
**Warning signs:** Works with `--plugin-dir .` but fails after `claude plugin install`.

## Code Examples

Verified patterns from official sources:

### Correct tsup.config.ts for Self-Contained Plugin Bundle

```typescript
// Source: tsup docs + https://github.com/egoist/tsup/issues/619
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'server/index': 'src/server/index.ts',
    'scripts/on-permission-request': 'scripts/on-permission-request.ts',
    'scripts/on-pre-tool-use': 'scripts/on-pre-tool-use.ts',
    'scripts/on-stop': 'scripts/on-stop.ts',
    'scripts/on-post-tool-failure': 'scripts/on-post-tool-failure.ts',
    'scripts/on-task-completed': 'scripts/on-task-completed.ts',
    'scripts/lib/bridge-client': 'scripts/lib/bridge-client.ts',
  },
  format: ['esm'],
  noExternal: [/(.*)/],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
});
```

### node:sqlite Migration -- Schema Initialization

```typescript
// Before (better-sqlite3):
import type Database from 'better-sqlite3';

export function initializeDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS escalations (...) STRICT`);
}

// After (node:sqlite):
import type { DatabaseSync } from 'node:sqlite';

export function initializeDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS escalations (...) STRICT`);
}
```

### node:sqlite Migration -- Store Constructor

```typescript
// Before:
import type Database from 'better-sqlite3';

export class EscalationStore {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  // ...

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = this.db.prepare(`INSERT INTO ...`);
    // ...
  }
}

// After:
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export class EscalationStore {
  private readonly db: DatabaseSync;
  private readonly insertStmt: StatementSync;
  // ...

  constructor(db: DatabaseSync) {
    this.db = db;
    this.insertStmt = this.db.prepare(`INSERT INTO ...`);
    // ...
  }
}
```

### node:sqlite Migration -- Server Entry Point

```typescript
// Before:
import Database from 'better-sqlite3';
const db = new Database(dbPath);

// After:
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(dbPath);
```

### Complete plugin.json Manifest

```json
{
  "name": "escalate",
  "version": "1.0.0",
  "description": "Smart escalation bridge between Claude Code and Slack -- routes decisions, approvals, and notifications to your phone",
  "author": {
    "name": "Kompani"
  },
  "license": "MIT",
  "keywords": ["slack", "escalation", "notifications", "approval", "hooks"]
}
```

### .mcp.json (already correct)

```json
{
  "mcpServers": {
    "escalate": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server/index.js"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
}
```

### End-to-End Validation Script

```bash
#!/bin/bash
set -euo pipefail

# 1. Build
pnpm run build

# 2. Verify dist/ is self-contained (no external imports except node: builtins)
EXTERNALS=$(grep -rh "^import.*from " dist/ | grep -v "from \"\./" | grep -v "from \"node:" | grep -v "from \"fs\"" | grep -v "from \"path\"" | grep -v "from \"crypto\"" | grep -v "from \"http\"" | grep -v "from \"url\"" || true)
if [ -n "$EXTERNALS" ]; then
  echo "ERROR: Found external imports in dist/:"
  echo "$EXTERNALS"
  exit 1
fi

# 3. Verify expected output structure
for f in dist/server/index.js dist/scripts/on-permission-request.js dist/scripts/on-stop.js; do
  [ -f "$f" ] || { echo "ERROR: Missing $f"; exit 1; }
done

# 4. Verify .mcp.json path matches dist/ structure
[ -f dist/server/index.js ] || { echo "ERROR: .mcp.json references dist/server/index.js but file missing"; exit 1; }

# 5. Copy to temp dir and test plugin loading
TMPDIR=$(mktemp -d)
cp -r .claude-plugin hooks .mcp.json dist "$TMPDIR/"
echo "Plugin copied to $TMPDIR -- test with: claude --plugin-dir $TMPDIR"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| better-sqlite3 (native addon) | node:sqlite (built-in) | Node.js 22.5.0 (Jul 2024) | Eliminates native compilation, enables full bundling |
| tsup entry as string array | tsup entry as object (path mapping) | Always available | Controls output paths to match plugin manifests |
| External deps + node_modules shipping | noExternal: [/(.*)/] full bundling | Always available | True self-contained distribution |
| npm-based Claude Code install | Native binary Claude Code | Late 2025 | Claude Code bundles own Node.js, but plugins still need Node available via PATH |

**Deprecated/outdated:**
- `better-sqlite3` for bundled plugin use cases: native addon makes bundling impossible without platform-specific builds
- `tsup` itself has been declared in maintenance mode by its author, recommending migration to `tsdown`. However, tsup 8.5.1 is stable and sufficient for this phase. Migration to tsdown is a future concern, not a v1 blocker.
- `skipNodeModulesBundle` in tsup: less precise than `noExternal` with regex. `noExternal: [/(.*)/]` is the current best practice for full bundling.

## Open Questions

1. **node:sqlite experimental warning suppression**
   - What we know: `node:sqlite` emits ExperimentalWarning to stderr. Since MCP uses stdio (stdin/stdout), stderr is safe for warnings.
   - What's unclear: Whether Claude Code's plugin runner suppresses `--no-warnings` or if users will see the warning.
   - Recommendation: Accept the warning. It is harmless on stderr. Add `--no-warnings=ExperimentalWarning` to `.mcp.json` args only if it proves annoying.

2. **Should dist/ be committed to git?**
   - What we know: For marketplace distribution, the plugin cache copies the directory. The source of truth depends on distribution strategy.
   - What's unclear: Whether the plugin will be distributed via marketplace (needs dist/ in repo) or via `--plugin-dir` only (can build locally).
   - Recommendation: Keep dist/ in .gitignore for now. Add a `prepublish` or release script that builds before distribution. If marketplace distribution is later needed, dist/ can be committed or a CI pipeline can build it.

3. **@slack/bolt CJS-to-ESM bundling edge cases**
   - What we know: @slack/bolt and its transitive deps (express, axios) are CJS. esbuild handles CJS-to-ESM conversion well for most cases.
   - What's unclear: Whether any edge case in the Slack SDK's deep dependency tree (express 5.x, @slack/socket-mode) will fail when bundled.
   - Recommendation: Build with noExternal, then run the server. If any CJS module fails at runtime, mark only that module as external and document the exception. This is the empirical verification approach.

4. **node:sqlite DatabaseSync constructor options vs pragma**
   - What we know: `enableForeignKeyConstraints: true` is a constructor option in node:sqlite. The current code uses `db.pragma('foreign_keys = ON')`.
   - What's unclear: Whether using the constructor option is more reliable than PRAGMA.
   - Recommendation: Use the constructor option `enableForeignKeyConstraints: true` for foreign keys and the `timeout` option for busy timeout, as these are purpose-built. Use `db.exec('PRAGMA journal_mode = WAL')` for journal mode (no constructor option exists for this).

## Sources

### Primary (HIGH confidence)
- [Node.js v25 SQLite documentation](https://nodejs.org/api/sqlite.html) - Full API reference for node:sqlite, stability level, constructor options, StatementSync methods
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) - Complete plugin manifest schema, CLAUDE_PLUGIN_ROOT behavior, plugin cache, MCP server configuration, hook configuration
- Codebase analysis: tsup.config.ts, package.json, .mcp.json, hooks.json, src/state/store.ts, src/state/schema.ts, src/server/index.ts, all scripts/

### Secondary (MEDIUM confidence)
- [tsup GitHub issue #447](https://github.com/egoist/tsup/issues/447) - Object entry format for controlling output file names
- [tsup GitHub issue #619](https://github.com/egoist/tsup/issues/619) - noExternal regex pattern for bundling all dependencies
- [tsup GitHub issue #728](https://github.com/egoist/tsup/issues/728) - esbuildOptions outbase for directory structure control
- [esbuild issue #1051](https://github.com/evanw/esbuild/issues/1051) - Native .node module handling (mark as external)
- [tsup jsdocs.io](https://www.jsdocs.io/package/tsup) - API reference for noExternal, skipNodeModulesBundle, splitting, banner
- @types/node sqlite.d.ts (local, verified) - TypeScript types for DatabaseSync, StatementSync, StatementResultingChanges
- Runtime verification: `node:sqlite` tested locally on Node.js 24.3.0 with exact API patterns used in codebase

### Tertiary (LOW confidence)
- tsup maintenance status: Author has mentioned recommending migration to `tsdown`, but this is not formally deprecated and v8.5.1 is stable

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - node:sqlite API verified locally with exact usage patterns from codebase; tsup bundling with noExternal verified via GitHub issues and jsdocs
- Architecture: HIGH - plugin structure verified against official Claude Code docs; output path fix verified via test build with object entries
- Pitfalls: HIGH - each pitfall identified from direct codebase analysis (path mismatch observed, API differences enumerated, CJS deps catalogued)

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable domain -- plugin system and tsup unlikely to change significantly)
