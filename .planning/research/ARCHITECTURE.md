# Architecture Research

**Domain:** Claude Code plugin with MCP server + Slack bot + multi-platform messaging adapter
**Researched:** 2026-02-18
**Confidence:** HIGH (sources: authoritative plugin-dev documentation from installed marketplace plugin, hookify/ralph-loop example plugins, CLAUDE.md project documentation)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLAUDE CODE PROCESS                           │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Hook Events (fire → script)               │   │
│  │  PermissionRequest  PreToolUse  PostToolUse  Stop  Subagent  │   │
│  └──────────────┬─────────────────────────────────┬────────────┘   │
│                 │ stdin: JSON event data           │ exit 0/2 + JSON │
│  ┌──────────────▼─────────────────────────────────▼────────────┐   │
│  │                   Hook Scripts (scripts/)                    │   │
│  │         Node.js scripts called by hooks/hooks.json           │   │
│  │    Read event → decide escalate/auto-handle → call MCP       │   │
│  └──────────────────────────┬────────────────────────────────┘    │
│                              │ HTTP to localhost                    │
│  ┌───────────────────────────▼─────────────────────────────────┐   │
│  │               MCP Server (servers/escalate-mcp.ts)           │   │
│  │         stdio transport → managed by Claude Code             │   │
│  │   Tools: escalate(), respond(), check_pending(), configure() │   │
│  │              Also directly callable by Claude LLM            │   │
│  └───────────────────────────┬─────────────────────────────────┘   │
└──────────────────────────────│─────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Messaging Core     │
                    │  (src/messaging/)    │
                    │  Escalation Engine   │
                    │  + State Store       │
                    └──────────┬──────────┘
                               │ Platform Adapter Interface
               ┌───────────────┼───────────────┐
               │               │               │
    ┌──────────▼───┐  ┌────────▼────┐  ┌──────▼──────┐
    │ Slack Adapter │  │ Telegram    │  │ GitHub      │
    │ (Phase 1)    │  │ (future)    │  │ (future)    │
    └──────────────┘  └─────────────┘  └─────────────┘
         │
    ┌────▼──────────────────────────────────────────┐
    │  Slack Platform (external)                     │
    │  Socket Mode (bidirectional WebSocket)         │
    │  Block Kit messages + interactive buttons      │
    │  Thread-based conversations                    │
    │  Voice note + image attachments               │
    └────────────────────────────────────────────────┘
         │ (user responds in Slack)
    ┌────▼──────────────────────────────────────────┐
    │  Claude API (external)                         │
    │  Used for: voice note transcription, image     │
    │  interpretation from Slack responses           │
    └────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                    | Responsibility                                                                                         | Communicates With                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `hooks/hooks.json`           | Registers hook event listeners in Claude Code                                                          | Declares which scripts to call on which events       |
| `scripts/` (hook scripts)    | Parse hook event JSON, apply escalation rules, call MCP server or return auto-decision                 | MCP server (HTTP), Claude Code (stdout/exit code)    |
| `servers/escalate-mcp.ts`    | MCP server process — provides tools for sending escalations, waiting for responses, configuration      | Messaging Core, Claude Code (via stdio/MCP protocol) |
| `src/messaging/engine.ts`    | Escalation engine — applies trigger config, decides what/when to escalate, manages pending escalations | Adapters, State Store, Claude API client             |
| `src/messaging/adapters/`    | Platform adapter implementations (one per platform)                                                    | Slack/Telegram/GitHub APIs                           |
| `src/messaging/state.ts`     | Pending escalation state store — tracks open requests and incoming responses                           | Local file or SQLite                                 |
| `src/config/`                | Escalation trigger configuration loader — what triggers escalation vs auto-handling                    | Read by engine and hook scripts                      |
| `src/claude-client.ts`       | Claude API calls for media interpretation (voice, images)                                              | Claude API                                           |
| `.mcp.json`                  | Declares MCP server process to Claude Code                                                             | Claude Code reads at startup                         |
| `.claude-plugin/plugin.json` | Plugin manifest — name, version, component paths                                                       | Claude Code reads at startup                         |

---

## Recommended Project Structure

```
escalate/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── .mcp.json                    # MCP server declaration (stdio)
├── hooks/
│   └── hooks.json               # Hook event registrations
├── scripts/                     # Hook scripts (called by hooks.json)
│   ├── on-permission-request.ts # Handles PermissionRequest events
│   ├── on-pre-tool-use.ts       # Handles PreToolUse events
│   ├── on-post-tool-failure.ts  # Handles PostToolUseFailure events
│   ├── on-stop.ts               # Handles Stop events (ask for verification)
│   └── lib/
│       ├── mcp-client.ts        # HTTP client to call MCP server tools
│       └── config.ts            # Read escalation config
├── servers/
│   └── escalate-mcp.ts          # MCP server (stdio, started by Claude Code)
├── src/
│   ├── messaging/
│   │   ├── engine.ts            # Escalation engine — core logic
│   │   ├── state.ts             # Pending escalation state
│   │   ├── adapters/
│   │   │   ├── interface.ts     # MessagingAdapter interface
│   │   │   ├── slack/
│   │   │   │   ├── index.ts     # Slack adapter (Bolt + Socket Mode)
│   │   │   │   ├── blocks.ts    # Block Kit message builders
│   │   │   │   └── events.ts    # Incoming Slack event handlers
│   │   │   └── (telegram/)      # Future: same interface
│   │   └── types.ts             # Shared types (EscalationRequest, Response)
│   ├── config/
│   │   ├── loader.ts            # Load/validate escalation triggers config
│   │   └── defaults.ts          # Default escalation rules
│   ├── claude-client.ts         # Claude API client for media interpretation
│   └── types.ts                 # Global types
├── config.json                  # User-editable escalation configuration
├── package.json
├── tsconfig.json
└── README.md
```

### Structure Rationale

- **`scripts/` vs `src/`**: Hook scripts are the entry points called by Claude Code — they must be fast and stateless. Heavy logic lives in `src/` and is accessed via the MCP server. This keeps hook scripts thin.
- **`servers/`**: MCP server is a long-running process managed by Claude Code. Separate directory signals it's a different process boundary.
- **`src/messaging/adapters/`**: The adapter pattern is enforced by directory structure — each platform gets its own directory with the same internal shape.
- **`hooks/hooks.json` wrapper format**: Plugin hooks must use the `{"hooks": {...}}` wrapper format, not the direct settings format.

---

## Architectural Patterns

### Pattern 1: Hook Script as Thin Dispatcher

**What:** Hook scripts read the event JSON, apply a fast escalation-or-not decision using config, then either return auto-approval or call the MCP server for escalation. They never contain business logic.

**When to use:** Always. Every hook script follows this pattern.

**Trade-offs:** Requires the MCP server to be running (it always is — Claude Code starts it). Adds one HTTP round-trip for escalated events, but that's fine because escalation implies human response time anyway.

**Example:**

```typescript
// scripts/on-permission-request.ts
import { readFileSync } from 'fs';
import { callMcpTool } from './lib/mcp-client';
import { shouldEscalate } from './lib/config';

async function main() {
  const event = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
  const config = loadConfig();

  if (!shouldEscalate(event, config)) {
    // Auto-approve — output nothing, exit 0
    process.exit(0);
  }

  // Send to MCP server for escalation + wait for response
  const response = await callMcpTool('escalate', {
    event_type: 'PermissionRequest',
    context: event,
    message: buildEscalationMessage(event),
  });

  // Return the decision back to Claude Code
  if (response.decision === 'deny') {
    process.stderr.write(
      JSON.stringify({
        hookSpecificOutput: { permissionDecision: 'deny' },
        systemMessage: response.reason,
      }),
    );
    process.exit(2);
  }

  process.exit(0); // allow
}

main().catch(() => process.exit(0)); // never block on error
```

### Pattern 2: MCP Server as Communication Hub

**What:** The MCP server (stdio transport) is the single process that owns all messaging state and external API connections. Hook scripts call it via a local HTTP bridge (or Unix socket). Claude LLM can also call it directly via MCP tools when it wants to proactively escalate.

**When to use:** Avoids having two separate processes fighting over Slack connections. One process, one Bolt app, one Socket Mode connection.

**Trade-offs:** The MCP server process is long-lived and must handle connection failures, reconnects, and state persistence. But this is the right place for that complexity.

**Why not stdio from hook scripts to MCP:** Hook scripts communicate with Claude Code via stdin/stdout. They cannot also use stdio to talk to the MCP server simultaneously. Use a local HTTP endpoint on the MCP server side.

**Example — .mcp.json:**

```json
{
  "escalate": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/servers/escalate-mcp.js"],
    "env": {
      "SLACK_BOT_TOKEN": "${ESCALATE_SLACK_BOT_TOKEN}",
      "SLACK_APP_TOKEN": "${ESCALATE_SLACK_APP_TOKEN}",
      "ESCALATE_HTTP_PORT": "7842",
      "CLAUDE_API_KEY": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

### Pattern 3: Adapter Interface for Multi-Platform Messaging

**What:** Define a `MessagingAdapter` interface that every platform implements. The escalation engine calls the interface, never the platform SDK directly.

**When to use:** Before writing a single line of Slack code. The interface forces you to think about the common shape.

**Trade-offs:** Minor abstraction overhead, but saves a rewrite when adding Telegram/GitHub.

**Example:**

```typescript
// src/messaging/adapters/interface.ts
export interface MessagingAdapter {
  // Send an escalation — returns a unique thread/message ID
  sendEscalation(request: EscalationRequest): Promise<string>;

  // Wait (long-poll) for user response to a specific escalation
  waitForResponse(escalationId: string, timeoutMs: number): Promise<UserResponse>;

  // Send a follow-up message to an existing escalation thread
  sendFollowUp(escalationId: string, message: string): Promise<void>;

  // Test connection
  isConnected(): boolean;
}

export interface EscalationRequest {
  title: string;
  context: string; // What Claude was doing
  question: string; // What the user needs to decide
  options?: string[]; // Button labels (if decision point)
  attachments?: Attachment[]; // Images, code snippets
  urgency: 'low' | 'medium' | 'high';
}

export interface UserResponse {
  type: 'button' | 'text' | 'voice' | 'image';
  value: string; // Text or interpreted content
  rawPayload?: unknown; // Platform-specific raw response
}
```

### Pattern 4: Polling-Based Response Capture for Hook Scripts

**What:** When a hook script escalates, it must block until the user responds (because Claude Code waits for the exit code). The MCP server holds the connection open; the hook script polls a `check_pending` tool every 2s with a timeout.

**When to use:** For PermissionRequest and PreToolUse hooks that need a human decision before allowing/blocking.

**Trade-offs:** Keeps the hook blocking while waiting — this is intentional. Claude Code must wait. Default timeout should be configurable (suggest 5-15 minutes).

**Example:**

```typescript
// scripts/lib/mcp-client.ts
export async function waitForDecision(
  escalationId: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<Decision> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await callMcpTool('check_pending', { escalation_id: escalationId });
    if (result.status === 'resolved') return result.decision;
    await sleep(2000); // poll every 2s
  }
  return 'timeout_allow'; // configurable default on timeout
}
```

---

## Data Flow

### Escalation Flow (Hook-Triggered)

```
[Claude attempts dangerous tool]
          ↓
[PreToolUse hook fires]
[on-pre-tool-use.ts reads stdin JSON]
          ↓
[config check: should escalate?]
   ↙              ↘
[NO: exit 0]   [YES: call MCP server HTTP]
               ↓
[MCP server: escalate() tool]
[Engine selects adapter (Slack)]
[Slack adapter sends Block Kit message]
[Socket Mode delivers to user's phone]
          ↓
[User taps button in Slack]
[Slack sends interactive payload]
[Socket Mode receives → Bolt handler]
[Engine resolves pending escalation]
          ↓
[Hook script's poll: check_pending() returns resolved]
[Hook script outputs JSON decision to stdout]
[exit 2 (deny) or exit 0 (allow)]
[Claude Code applies the decision]
```

### Claude-Initiated Escalation Flow (MCP Tool)

```
[Claude LLM decides to escalate proactively]
[Calls MCP tool: mcp__plugin_escalate_escalate__escalate()]
          ↓
[MCP server handles tool call]
[Same engine + adapter path as hook-triggered]
          ↓
[User responds in Slack]
[MCP tool returns response to Claude]
[Claude continues with user's answer]
```

### Voice/Image Response Flow

```
[User sends voice note in Slack thread]
[Bolt handler: receives file_share event]
[Slack adapter downloads audio file]
          ↓
[Claude API: messages endpoint with audio content]
[Transcription + interpretation returned]
          ↓
[Response normalized to UserResponse{ type: 'voice', value: '...' }]
[Pending escalation resolved with interpreted text]
```

### Key Data Flows

1. **Hook event → decision**: JSON in via stdin → config check → optional Slack round-trip → JSON out via stdout/stderr + exit code
2. **Escalation → response**: EscalationRequest → platform adapter → user's device → Bolt event → UserResponse
3. **Media interpretation**: Slack file URL → download → Claude API (multimodal) → interpreted text string
4. **Config loading**: `config.json` file → loader → escalation engine (checked on each hook event)

---

## Integration Points

### External Services

| Service              | Integration Pattern                                     | Notes                                                           |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Claude Code (hooks)  | stdin/stdout JSON + exit codes                          | Synchronous; hook script must exit with decision                |
| Claude Code (MCP)    | stdio transport; JSON-RPC via @modelcontextprotocol/sdk | MCP server process is long-lived                                |
| Slack API            | @slack/bolt Socket Mode (WebSocket); @slack/web-api     | Socket Mode avoids exposing public HTTP endpoints               |
| Claude API           | @anthropic-ai/sdk; messages endpoint, multimodal        | For voice note transcription + image interpretation only        |
| Slack file downloads | HTTPS with Authorization: Bearer token                  | Files are not publicly accessible; must download with bot token |

### Internal Boundaries

| Boundary                      | Communication                            | Notes                                                                    |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Hook script ↔ MCP server      | Local HTTP (port configured via env var) | MCP server exposes a thin HTTP endpoint alongside its stdio MCP protocol |
| MCP server ↔ Messaging Engine | Direct function call (same process)      | No IPC needed — engine is imported by MCP server                         |
| Messaging Engine ↔ Adapters   | TypeScript interface (MessagingAdapter)  | Engine never imports Slack SDK directly                                  |
| Adapter ↔ State Store         | Direct function call (same process)      | State store is an in-process singleton                                   |
| State Store ↔ disk            | File system (JSON) or SQLite             | SQLite preferred — handles concurrent reads from hook polls              |

---

## Scaling Considerations

| Scale                   | Architecture Adjustments                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 user (personal)       | Local process, SQLite state, Socket Mode for Slack — current design works perfectly                                                                  |
| 2-10 users (small team) | Same design; add per-user config, multi-user Slack workspace routing                                                                                 |
| Cloud deployment        | Wrap MCP server in a persistent process (Fly.io, Railway); switch Slack to HTTP Events API with public endpoint; externalize state to Redis/Postgres |
| Multi-workspace Slack   | Add workspace registry in state store; scope Slack connections per workspace                                                                         |

### Scaling Priorities

1. **First bottleneck (local):** Hook scripts block on Slack round-trips — mitigation: configurable timeout + sensible defaults for "allow on timeout"
2. **Second bottleneck (cloud):** Stateless MCP server instances can't share pending escalation state — mitigation: externalize state store to Redis before deploying to cloud

---

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Hook Scripts

**What people do:** Put escalation rules, Slack SDK calls, and API calls directly in the hook script files.

**Why it's wrong:** Hook scripts are loaded and called on every event. They are thin entry points. Putting business logic there means duplication between the hook-triggered path and the Claude-MCP-tool-triggered path. It also makes testing harder.

**Do this instead:** Hook scripts are dispatchers only. They read config, decide "escalate or not", and if escalating, delegate to the MCP server. All messaging logic lives in `src/messaging/`.

### Anti-Pattern 2: Using stdio for Hook-to-MCP Communication

**What people do:** Try to have hook scripts communicate with the MCP server via a pipe or the same stdin/stdout channel.

**Why it's wrong:** Hook scripts' stdin/stdout is owned by Claude Code for the hook protocol. The MCP server's stdin/stdout is owned by Claude Code for the MCP protocol. You cannot share these channels.

**Do this instead:** MCP server exposes a local HTTP endpoint (e.g., `localhost:7842`) that hook scripts call via fetch/axios. The port is configured via an environment variable shared between both.

### Anti-Pattern 3: One Slack Connection per Hook Invocation

**What people do:** Hook scripts create a Slack Bolt app instance on every invocation.

**Why it's wrong:** Socket Mode maintains a persistent WebSocket connection. Creating and destroying it per hook call is slow, resource-intensive, and misses incoming Slack events between hook calls.

**Do this instead:** The MCP server is the single long-lived process that owns the Slack connection. Hook scripts call into it via HTTP. The Socket Mode WebSocket lives for the entire Claude Code session.

### Anti-Pattern 4: Hardcoded Escalation Rules

**What people do:** Hardcode "always escalate PermissionRequest for Bash tool" directly in hook scripts.

**Why it's wrong:** Different users and projects have different tolerance levels. Hardcoded rules make the plugin unshippable to others.

**Do this instead:** All escalation rules live in `config.json` with sensible defaults. Hook scripts read the config file at runtime. Users customize the file to tune behavior.

### Anti-Pattern 5: Blocking Hook on Slow Network

**What people do:** Set no timeout on the Slack response wait, causing the hook to block indefinitely if the user is offline.

**Why it's wrong:** Claude Code itself may have a hook timeout. If the user doesn't respond, Claude is frozen.

**Do this instead:** Always use a configurable timeout (default: 10 minutes for PermissionRequest, shorter for PreToolUse). On timeout, apply a configurable default decision (suggest "allow" for safety, but make it configurable). Log the timeout so the user knows.

---

## Build Order Implications

The component graph drives the build order:

```
config.json schema + loader
        ↓
MessagingAdapter interface + types
        ↓
State store (SQLite)
        ↓
Slack adapter (Bolt + Socket Mode + Block Kit)
        ↓
Claude API client (for media)
        ↓
Escalation engine (wires adapter + state + claude-client)
        ↓
MCP server (wraps engine, exposes tools + HTTP bridge)
        ↓
Hook scripts (call MCP server HTTP bridge)
        ↓
hooks.json + plugin.json (declares everything to Claude Code)
        ↓
Integration test: full escalation round-trip
```

**Build first:** The `MessagingAdapter` interface and shared types. Everything else depends on this shape.

**Build second:** The Slack adapter in isolation — it can be developed and tested with a mock engine before the full system exists.

**Build third:** The MCP server. It's the integration point. Only wire it up after the adapter and engine work independently.

**Build last:** Hook scripts. They are thin — 50 lines max each. Only write them after the MCP server's HTTP bridge is ready.

---

## Sources

- `CLAUDE.md` (project root) — authoritative Claude Code plugin structure, hook events, MCP configuration patterns [HIGH confidence]
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/SKILL.md` — hook types, events, input/output formats, plugin hooks.json wrapper format [HIGH confidence]
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/mcp-integration/SKILL.md` — MCP server types (stdio/SSE/HTTP/ws), process lifecycle, tool naming format [HIGH confidence]
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/mcp-integration/references/server-types.md` — stdio process lifecycle: Claude Code spawns, communicates via stdin/stdout JSON-RPC, terminates on exit [HIGH confidence]
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/` — real hook plugin example using command hooks, scripts, CLAUDE_PLUGIN_ROOT [HIGH confidence]
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/` — real Stop hook example showing transcript_path in JSON, jq parsing pattern [HIGH confidence]
- `.planning/PROJECT.md` (this project) — requirements, constraints, key decisions [HIGH confidence]

---

_Architecture research for: Escalate — Claude Code plugin (hooks + MCP + Slack)_
_Researched: 2026-02-18_
