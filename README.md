# Escalate

A Claude Code plugin that bridges Claude Code and Slack, letting you monitor and control autonomous coding sessions from your phone.

## Why Escalate?

Without Escalate, running Claude Code autonomously means one of two things:

**Sitting at your computer watching.** Claude stops every few minutes to ask for permission — "Can I run this Bash command?", "Can I write this file?" You're glued to your screen, clicking Approve over and over. You can't step away for coffee, take a walk, or do anything else. You're basically a human rubber stamp.

**Using Teleport (remote sessions).** Claude Code's Teleport feature lets you push sessions to the cloud and check back later. But there's a catch: when Claude hits a decision point, it just *waits*. Silently. You have no idea it's blocked until you manually check in. If Claude needs permission at minute 3 of a 30-minute task, the remaining 27 minutes are wasted — it's sitting idle while you assume it's still working. There's no notification, no ping, no way to know.

**With Escalate, you get a third option.** Start Claude on a big task, put your phone in your pocket, and walk away. When Claude actually needs you — a permission approval, a decision about approach, a failure that needs attention — your phone buzzes with a Slack message. You glance at it, tap Approve, and Claude keeps going. The rest of the time? Silence. No notification noise, no screen-watching, no checking in.

### What it looks like

1. You kick off a task: `claude "refactor the auth module"`
2. Claude works autonomously — reading files, planning, writing code
3. Claude needs to run `rm -rf old-auth/` → your phone buzzes
4. You see: **"PreToolUse: Bash"** with the command and context
5. You tap **Approve** → Claude continues instantly
6. 10 minutes later, Claude finishes — you get a session summary DM

That's it. You were making lunch the whole time.

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
- `channels:history` - Receive thread replies in public channels
- `groups:history` - Receive thread replies in private channels (if using a private channel)
- `reactions:read` - Read emoji reactions
- `files:read` - Download voice note attachments

**Event Subscriptions** (under "Subscribe to bot events"):
- `message.channels` - Thread replies in public channels
- `message.groups` - Thread replies in private channels (if using a private channel)

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
export ESCALATE_SLACK_BOT_TOKEN="xoxb-..."       # Bot User OAuth Token
export ESCALATE_SLACK_APP_TOKEN="xapp-..."       # App-Level Token (Socket Mode)
```

Optional (only needed for voice note transcription):

```bash
export ESCALATE_OPENAI_API_KEY="sk-..."       # OpenAI API key for Whisper
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
- [x] **Phase 5:** Escalation Intelligence (auto-approval rules, quiet hours, audit logging)
- [x] **Phase 6:** Multimodal Responses (voice notes, emoji reactions)
- [x] **Phase 7:** Plugin Packaging (self-contained distribution)
- [x] **Phase 8:** UUID Fix (escalation round-trip ID consistency)
- [x] **Phase 9:** Config & Manifest Fixes (env vars, audit gate, version sync)

## License

MIT -- see [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
