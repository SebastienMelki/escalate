# Escalate

## What This Is

A Claude Code plugin that acts as a smart communication bridge between Claude Code (running GSD workflows) and messaging platforms. It intercepts events via hooks, sends rich interactive messages to the user's phone (starting with Slack), waits for responses, and feeds decisions back to Claude — enabling fully autonomous GSD runs where the human only gets pinged when their attention is genuinely needed.

## Core Value

Run GSD end-to-end autonomously, escalating to the human through their phone only when a decision, approval, or intervention is actually required.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Hook-based event interception (PermissionRequest, PreToolUse, Stop, PostToolUseFailure, AskUserQuestion-like decision points, verification gates)
- [ ] Configurable escalation triggers — user tunes what gets escalated vs auto-handled
- [ ] MCP server for messaging platform communication
- [ ] Slack integration via Block Kit — interactive buttons, polls, threaded conversations
- [ ] Two-way communication — user responds in Slack thread (text or voice note), Claude picks up the response
- [ ] Voice note support — Claude transcribes/interprets audio via Claude API
- [ ] Image/screenshot support — Claude can send and interpret visual content
- [ ] Adapter/abstraction layer for messaging platforms (start Slack, add Telegram/WhatsApp later)
- [ ] Local process that can be deployed to cloud later
- [ ] End-to-end GSD flow — run `/gsd:new-project` through completion with only Slack-based check-ins
- [ ] GitHub awareness — bot is aware of PRs, issues, discussions, comments (future phase, but architect for it now)
- [ ] Shareable plugin — others can install and configure with their own Slack workspace/GitHub

### Out of Scope

- Mobile app — communication happens through existing chat apps, not a custom app
- Telegram/WhatsApp integration in v1 — abstract the layer, but only ship Slack first
- Full GitHub bot in v1 — architect for it, but GitHub integration is a later phase
- Custom AI model hosting — uses Claude API for media interpretation
- Real-time streaming of Claude's output to Slack — only escalation messages, not a live feed

## Context

- This is a Claude Code plugin (`.claude-plugin/plugin.json` manifest, hooks, MCP server, skills, agents)
- Built on top of the GSD workflow system which has its own events, stages, and approval gates
- Claude Code hooks provide the interception points: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `SubagentStop`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `TeammateIdle`, `TaskCompleted`
- Hook commands receive JSON on stdin and return decisions via exit codes and stdout JSON
- MCP servers in plugins are defined in `.mcp.json` and start automatically when the plugin is enabled
- Slack Block Kit provides rich interactive message components (buttons, selects, modals, threads)
- The `${CLAUDE_PLUGIN_ROOT}` environment variable resolves to the plugin directory at runtime
- GSD uses `AskUserQuestion` for decision points — these need to be intercepted and forwarded to Slack
- GSD uses stage banners, spawning indicators, and checkpoint boxes — these provide context for escalation messages

## Constraints

- **Tech stack**: TypeScript/Node.js — matches Claude Code ecosystem, required for MCP server
- **Plugin structure**: Must follow Claude Code plugin conventions (`.claude-plugin/plugin.json`, hooks at root, MCP at root)
- **Slack API**: Requires Slack app with bot token, socket mode or webhook for real-time responses
- **Claude API**: Needed for interpreting voice notes and images from user responses
- **Portability**: Design messaging layer as an adapter so Telegram/WhatsApp/GitHub can be added without rewriting core logic
- **Shareability**: Must be configurable (no hardcoded Slack tokens, channels, or user IDs)

## Key Decisions

| Decision                            | Rationale                                                                                                            | Outcome   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| Hooks + MCP server architecture     | Hooks intercept Claude Code events natively; MCP server provides communication tools Claude can also use proactively | — Pending |
| Start with Slack                    | Most feature-rich bot platform (Block Kit, threads, reactions, voice), user's primary platform                       | — Pending |
| Adapter pattern for messaging       | Enables adding Telegram, WhatsApp, GitHub without rewriting core                                                     | — Pending |
| Claude API for media interpretation | Consistent quality, no dependency on platform-specific transcription                                                 | — Pending |
| TypeScript/Node.js                  | Claude Code ecosystem compatibility, MCP server support, Slack SDK availability                                      | — Pending |
| Local-first, cloud-ready            | Start as local MCP server, design for deployment to Cloudflare/AWS later                                             | — Pending |
| GitHub as a communication channel   | PRs, issues, comments are part of the dev workflow — bot should be aware of both Slack and GitHub context            | — Pending |

---

_Last updated: 2026-02-18 after initialization_
