# Escalate

A Claude Code plugin that bridges Claude Code and Slack, letting you monitor and control autonomous coding sessions from your phone.

Claude Code events (permission requests, tool failures, session stops) get forwarded to a Slack channel as rich interactive messages. You tap Approve/Deny buttons or type a reply in the thread, and your decision flows back to Claude instantly.

## How It Works

```
Claude Code ──hooks──> Escalate MCP Server ──Slack API──> Your Phone
                              │                              │
                         SQLite store  <───── button tap ────┘
                              │
Claude Code <──response──────┘
```

1. **Hook scripts** intercept Claude Code events (PermissionRequest, PreToolUse, Stop, PostToolUseFailure)
2. **HTTP bridge** receives hook events and stores them in SQLite with a correlation ID
3. **Slack adapter** sends Block Kit messages with context, buttons, and thread support
4. **You respond** by tapping a button or typing in the Slack thread
5. **Hook script** polls until your response appears, then feeds the decision back to Claude

Each hook script is under 50 lines. All the logic lives in the MCP server.

## Prerequisites

- Node.js >= 22
- A Slack workspace with a bot app ([create one](https://api.slack.com/apps))
- Claude Code installed

## Slack App Setup

Create a Slack app with these permissions:

**Bot Token Scopes:**
- `chat:write` - Send messages
- `reactions:read` - Read emoji reactions (future)

**Socket Mode:** Enable Socket Mode and generate an app-level token with `connections:write` scope.

**Interactivity:** Enable interactivity (Socket Mode handles the endpoint automatically).

## Installation

```bash
# Clone the repo
git clone https://github.com/kompani/escalate.git
cd escalate

# Install dependencies
pnpm install

# Build
pnpm build
```

## Configuration

### Environment Variables

Set these in your shell or `.env` (never commit secrets):

```bash
export SLACK_BOT_TOKEN="xoxb-..."       # Bot User OAuth Token
export SLACK_APP_TOKEN="xapp-..."       # App-Level Token (Socket Mode)
export SLACK_SIGNING_SECRET="..."       # Signing Secret (from Basic Information)
```

### Config File

Create `escalate.config.json` in your project root:

```json
{
  "slack": {
    "channelId": "C0123456789"
  }
}
```

`channelId` is the Slack channel where escalation messages will be posted. Right-click a channel in Slack > "View channel details" to find the ID at the bottom.

### Register as a Claude Code Plugin

```bash
claude --plugin-dir /path/to/escalate
```

Or add to your project's `.claude/plugins.json`.

## What Gets Escalated

| Event | What Happens | Your Options |
|-------|-------------|--------------|
| **PermissionRequest** | Claude needs permission for an action | Approve / Deny |
| **PreToolUse** | Dangerous tool (Bash, Write, Edit) about to run | Approve / Deny |
| **Stop** | Claude wants to end the session | Stop / Continue |
| **PostToolUseFailure** | A tool failed (notification only) | Acknowledged |

## Architecture

```
escalate/
├── .claude-plugin/plugin.json    # Plugin manifest
├── hooks/hooks.json              # Event handler registration
├── scripts/                      # Thin hook dispatchers (<50 lines each)
│   ├── on-permission-request.ts
│   ├── on-pre-tool-use.ts
│   ├── on-stop.ts
│   ├── on-post-tool-failure.ts
│   └── lib/
│       ├── bridge-client.ts      # Shared HTTP client for hook scripts
│       └── output-helpers.ts     # JSON output builders
├── src/
│   ├── config/                   # Zod-validated config loading
│   ├── state/                    # SQLite escalation store
│   ├── server/
│   │   ├── mcp-server.ts         # MCP server (stdio transport)
│   │   ├── http-bridge.ts        # HTTP bridge for hook communication
│   │   └── index.ts              # Server entrypoint
│   ├── slack/
│   │   ├── adapter.ts            # SlackAdapter (Socket Mode)
│   │   ├── blocks.ts             # Block Kit message builder
│   │   └── handlers.ts           # Button/thread action handlers
│   └── types/                    # Shared TypeScript types
└── test/                         # Vitest test suite
```

## Development

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format
```

## Roadmap

- [x] **Phase 1:** Foundation (ESM skeleton, types, config)
- [x] **Phase 2:** State Store & IPC Bridge (SQLite, MCP server, HTTP bridge)
- [x] **Phase 3:** Slack Adapter (Socket Mode, Block Kit, interactive buttons)
- [x] **Phase 4:** Hook Scripts & Escalation Loop (end-to-end event flow)
- [ ] **Phase 5:** Escalation Intelligence (auto-approval rules, quiet hours, audit logging)
- [ ] **Phase 6:** Multimodal Responses (voice notes, emoji reactions)
- [ ] **Phase 7:** Plugin Packaging (self-contained distribution)

## License

MIT -- see [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
