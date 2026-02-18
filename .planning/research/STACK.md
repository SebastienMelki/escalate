# Stack Research

**Domain:** Claude Code plugin + MCP server + Slack bot integration bridge
**Researched:** 2026-02-18
**Confidence:** HIGH — all versions verified via `npm show` against live registry; MCP SDK internals verified from cached source in `~/.npm/_npx/`

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.9.3 | Language | Strict type safety for complex async hook/MCP/Slack interaction flows; catches stdio protocol errors at compile time; ESM-native in TS 5.x |
| Node.js | >=20.0.0 (LTS 22.x preferred) | Runtime | MCP SDK requires >=18; Slack Bolt requires >=18; `tsx` (dev runner) requires ^20 or ^22; Node 22 is current LTS as of 2026 |
| `@modelcontextprotocol/sdk` | 1.27.0 | MCP server implementation | Official Anthropic SDK; provides `McpServer` (high-level), `StdioServerTransport` (for Claude Code plugin), `StreamableHTTPServerTransport` (for remote access); ESM-native |
| `@slack/bolt` | 4.6.0 | Slack app framework | Official Slack SDK; handles OAuth, event subscriptions, interactive components (Block Kit buttons, modals), socket mode for local-first dev; Node >=18 |
| `@anthropic-ai/sdk` | 0.76.0 | Claude API client | Required for interpreting voice notes/images via Claude's vision/audio API before feeding decisions back |
| `zod` | 4.3.6 | Schema validation | MCP SDK peer dependency (`^3.25 || ^4.0`); use for defining tool input schemas in `McpServer.registerTool()`; also validates hook stdin payloads |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@slack/web-api` | 7.14.1 | Slack REST API client | Sending rich Block Kit messages, uploading files, fetching message history; bundled with `@slack/bolt` but can be used directly for non-event flows |
| `@slack/socket-mode` | 2.0.5 | WebSocket connection to Slack | Local-first development without a public URL; no ngrok needed; bundled with `@slack/bolt` |
| `slack-block-builder` | 2.8.0 | Composable Block Kit builder | Fluent API for building complex Slack messages (blocks, buttons, polls); avoids raw JSON hell for interactive messages; verified on npm |
| `p-queue` | 9.1.0 | Async queue with concurrency control | Managing Slack response polling: wait for user reply without blocking; ESM-only (type: module), Node >=20 required |
| `better-sqlite3` | 12.6.2 | Local SQLite persistence | Tracking pending escalations (message_ts, channel, session_id, timeout); local-first; synchronous API fits hook script pattern; Node 20.x/22.x |
| `@types/better-sqlite3` | 7.6.13 | TypeScript types for better-sqlite3 | Dev dependency for sqlite3 types |
| `pino` | 10.3.1 | Structured logging | Fast JSON logging; works cleanly with stdout/stderr in MCP stdio context (hook scripts must not pollute stdout); minimal overhead |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` | TypeScript execute (dev runner) | Run `.ts` files directly without a build step; powered by esbuild; use for hook scripts and dev iteration; requires Node ^20 or ^22 |
| `tsup` | TypeScript bundler | Bundle MCP server and hook scripts for distribution in the plugin; ESM output; esbuild-based; Node >=18; produces clean `dist/` for `${CLAUDE_PLUGIN_ROOT}` paths |
| `vitest` | Test framework | Fast, ESM-native, TypeScript-first; works well with MCP tool handlers and Slack event handlers; Node >=20; replaces Jest in ESM projects |
| `typescript` | Type checker | 5.9.3; use `tsconfig` with `"module": "Node16"` or `"NodeNext"` for ESM-compatible output |
| `@types/node` | Node.js type definitions | 25.2.3; required for `process.stdin`, `process.stdout` in MCP stdio transport |

---

## Installation

```bash
# Core runtime dependencies
npm install @modelcontextprotocol/sdk @slack/bolt @anthropic-ai/sdk zod

# Supporting libraries
npm install @slack/web-api slack-block-builder p-queue better-sqlite3 pino

# Dev dependencies
npm install -D typescript tsx tsup vitest @types/node @types/better-sqlite3
```

---

## Key Architecture Decisions Driven by Stack

### MCP Transport: stdio (not HTTP) for Claude Code Plugin

Claude Code's `.mcp.json` plugin config uses the `command`/`args` pattern (like context7: `"command": "npx", "args": ["-y", "@upstash/context7-mcp"]`). This means the MCP server runs as a child process communicating over **stdio** — not HTTP. Use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio`.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'escalate', version: '1.0.0' });
// register tools here
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Critical:** MCP SDK is ESM-only (`"type": "module"` in its package.json). Your project must also be ESM or use a bundler (tsup) that outputs ESM.

### Slack: Socket Mode for Local-First Development

Slack Bolt's Socket Mode lets the app receive events over a persistent WebSocket without exposing a public HTTP endpoint. This is ideal for local development and CI environments. Switch to HTTP mode (with `StreamableHTTPServerTransport`) only when going cloud-hosted.

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN, // xapp-... token
});
```

### Hook Scripts: Node.js CJS or ESM with stdin/stdout protocol

Claude Code hooks receive JSON on stdin. Exit 0 = success; exit 2 = blocking error. Hook scripts must write to **stdout only** for control messages; use **stderr** for logs. Since hook scripts are invoked as subprocesses by Claude Code, keep them lightweight — avoid importing the full MCP server. Hook scripts communicate with the running MCP server process via IPC or SQLite state.

```bash
# hooks/hooks.json pattern
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/escalate-stop.js",
      "timeout": 30
    }]
  }]
}
```

### The "Wait for Slack Reply" Pattern: SQLite + Polling

The core escalation loop requires Claude Code to pause, send a Slack message, and wait for a human reply. Since Claude Code hooks are synchronous subprocess calls (they block Claude's next action while running), use this pattern:

1. Hook script writes pending escalation to SQLite with a unique `session_id`
2. Hook script polls SQLite (or a temp file) in a loop until Slack bot writes the reply back
3. Hook script exits 0 with the reply JSON on stdout
4. The Slack bot (separate process) receives the interactive component payload and writes it to SQLite

`better-sqlite3` is ideal here (synchronous, no async overhead in polling loop). `p-queue` manages concurrent escalations from different Claude sessions.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@slack/bolt` v4 | Slack Events API raw HTTP | When you want zero SDK dependencies; bolt is official and maintained, raw HTTP adds complexity with no benefit here |
| `better-sqlite3` | Redis / file-based IPC | Redis adds deployment complexity for a local-first plugin; file-based IPC is fragile; SQLite is zero-config, local, and synchronous |
| `StdioServerTransport` (MCP) | `StreamableHTTPServerTransport` | When the plugin needs to serve remote clients over HTTP (cloud-ready phase); not needed for Claude Code local plugin |
| `slack-block-builder` | Raw Block Kit JSON | Raw JSON is error-prone for nested interactive blocks; `slack-block-builder` provides type-safe composable API |
| Socket Mode (Slack) | HTTP + ngrok | ngrok is a dev-only workaround; Socket Mode works in production too for small-scale use |
| `tsx` (dev) + `tsup` (build) | `ts-node` | `ts-node` has poor ESM support; `tsx` is faster (esbuild-based) and ESM-native; `tsup` handles bundling for distribution |
| `vitest` | Jest | Jest has ESM configuration pain; Vitest is ESM-native, faster, and compatible with the project's ESM requirement |
| `pino` | `winston` | Winston has more overhead; pino writes structured JSON to stderr without touching stdout (critical for MCP stdio compliance) |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `Server` (low-level MCP class) | Deprecated in favor of `McpServer` per SDK source: "Use `McpServer` instead for the high-level API. Only use `Server` for advanced use cases." | `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` |
| `ts-node` | Poor ESM support; slow; struggles with Node16 module resolution required by MCP SDK | `tsx` for development, `tsup` for builds |
| `SSEServerTransport` (MCP) | Deprecated transport; replaced by `StreamableHTTPServerTransport` | `StreamableHTTPServerTransport` if HTTP transport ever needed |
| `require()` / CommonJS in MCP server | MCP SDK is ESM-only; mixing CJS breaks imports | Pure ESM project (`"type": "module"` in package.json) |
| `@slack/bolt` v3 | v3 is on a `@slack/bolt@3.19.0` dist-tag, not `latest`; v4 is current with Express v5, no breaking changes for basic usage | `@slack/bolt` v4.6.0 |
| `console.log` in hook scripts or MCP server | In stdio MCP context, anything written to stdout that isn't a valid JSON-RPC message breaks the protocol | `pino` writing to stderr; use `server.sendLoggingMessage()` for in-band MCP logging |
| `multer` / file upload libraries for Slack | Slack sends file URLs, not raw uploads; fetch the file URL using the bot token via `@slack/web-api`'s `files.info` | `@slack/web-api` + `node-fetch` or native `fetch` (Node 22 built-in) |

---

## Stack Patterns by Variant

**If local-only (Claude Code plugin, no cloud deployment):**
- Use `StdioServerTransport` for MCP
- Use Socket Mode for Slack
- Use `better-sqlite3` for state
- Run with `tsx` in dev, bundle with `tsup` for release

**If cloud-hosted (team-wide deployment, public webhook URL):**
- Use `StreamableHTTPServerTransport` for MCP (wraps Node.js HTTP)
- Use Slack HTTP mode (Events API webhooks)
- Swap `better-sqlite3` for PostgreSQL (add `pg` + connection pooling)
- Deploy as a Node.js service (Docker or Fly.io)

**If multi-platform adapter (Teams, Discord, etc.):**
- Define `MessagingAdapter` interface with `send()`, `waitForReply()`, `parseMedia()` methods
- Implement `SlackAdapter`, `TeamsAdapter` etc.
- The MCP server tools call the adapter, not Slack directly
- Do NOT leak Slack-specific types into the MCP layer

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk@1.27.0` | `zod@^3.25 \|\| ^4.0` | MCP SDK peer dep; use zod 4.x (latest is 4.3.6) |
| `@modelcontextprotocol/sdk@1.27.0` | `node>=18` | Strict ESM; recommend Node 22 LTS for tsx compatibility |
| `@slack/bolt@4.6.0` | `@slack/web-api@^7.12.0`, `@slack/socket-mode@^2.0.5` | Bolt 4 bundles these; no separate install needed |
| `@slack/bolt@4.6.0` | `node>=18` | Same as MCP SDK; Node 22 LTS recommended |
| `p-queue@9.1.0` | `node>=20` | ESM-only; requires Node 20+ |
| `tsx@4.21.0` | `node ^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0` | Will not work on Node 18 |
| `better-sqlite3@12.6.2` | `node 20.x \|\| 22.x \|\| 23.x \|\| 24.x \|\| 25.x` | Will not work on Node 18 |
| `tsup@8.5.1` | `node>=18` | Fine on Node 18+; ESM output recommended |

**Recommended pinned engine:** `"node": ">=22.0.0"` in `package.json` — satisfies all libraries including the stricter `tsx` and `p-queue` requirements.

---

## Claude Code Plugin-Specific Requirements

These are requirements derived from the CLAUDE.md and real plugin analysis, not just library docs:

1. **`plugin.json`** must be in `.claude-plugin/` — only file in that directory
2. **Hook scripts** must be executable (`chmod +x`) and referenced as `${CLAUDE_PLUGIN_ROOT}/scripts/...`
3. **MCP server config** in `.mcp.json` at plugin root uses `command`/`args` format (stdio transport)
4. **Hook exit codes:** `0` = success, `2` = block Claude action; stdout used for response injection, stderr for logs
5. **Plugin distribution:** Plugin is copied to `~/.claude/plugins/cache/`; paths cannot traverse outside plugin root — bundle all dependencies with `tsup` or use `npm pack` pattern
6. **ESM requirement propagates:** If MCP server is ESM, tsup must output `format: ['esm']`; hook scripts can stay CJS if using `.cjs` extension

---

## Sources

- `npm show @modelcontextprotocol/sdk --json` — version 1.27.0, deps, exports, engine requirements (HIGH confidence)
- `~/.npm/_npx/5a9d879542beca3a/node_modules/@modelcontextprotocol/sdk/dist/esm/server/` — actual TypeScript `.d.ts` files; verified `McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`, `createMcpExpressApp` (HIGH confidence)
- `npm show @slack/bolt --json` — version 4.6.0, deps, engine requirements, dist-tags (HIGH confidence)
- `npm show @slack/web-api` — version 7.14.1, engine requirements (HIGH confidence)
- `npm show @anthropic-ai/sdk` — version 0.76.0 (HIGH confidence)
- `npm show zod` — version 4.3.6 (HIGH confidence)
- `npm show tsx` — version 4.21.0, Node ^20 engine requirement (HIGH confidence)
- `npm show tsup` — version 8.5.1 (HIGH confidence)
- `npm show vitest` — version 4.0.18, Node >=20 (HIGH confidence)
- `npm show better-sqlite3` — version 12.6.2, Node 20.x/22.x requirement (HIGH confidence)
- `npm show p-queue` — version 9.1.0, ESM-only, Node >=20 (HIGH confidence)
- `npm show slack-block-builder` — version 2.8.0 (MEDIUM confidence — not verified via official docs, but widely adopted)
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/*/hooks/hooks.json` — real plugin hook patterns (HIGH confidence — first-party plugin examples)
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.mcp.json` — confirmed `command`/`args` stdio pattern for Claude Code MCP (HIGH confidence)
- `CLAUDE.md` in escalate project — Claude Code plugin conventions, hook events, stdin/stdout protocol (HIGH confidence — first-party docs)

---

*Stack research for: Escalate — Claude Code plugin + MCP server + Slack integration bridge*
*Researched: 2026-02-18*
