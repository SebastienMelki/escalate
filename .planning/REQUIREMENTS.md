# Requirements: Escalate

**Defined:** 2026-02-18
**Core Value:** Run GSD end-to-end autonomously, escalating to the human through their phone only when a decision, approval, or intervention is actually required.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Hook Interception

- [ ] **HOOK-01**: Plugin intercepts PermissionRequest events via hook script that receives JSON on stdin and returns decision via exit code
- [ ] **HOOK-02**: Plugin intercepts PreToolUse events to gate dangerous tool executions
- [ ] **HOOK-03**: Plugin intercepts Stop events to ask user about next steps before session ends
- [ ] **HOOK-04**: Plugin intercepts PostToolUseFailure events to notify user of failures requiring attention
- [ ] **HOOK-05**: Hook scripts are thin dispatchers (<50 lines) that delegate all logic to MCP server via HTTP

### Slack Messaging

- [ ] **SLCK-01**: Escalation messages use Slack Block Kit formatting with structured layout (title, context, question, options)
- [ ] **SLCK-02**: Messages include interactive Approve/Deny/Snooze buttons for binary and multi-choice decisions
- [ ] **SLCK-03**: Messages include rich GSD context — current phase, task name, what Claude was about to do, and why it needs a decision
- [ ] **SLCK-04**: MCP server maintains persistent Socket Mode WebSocket connection (no public URL required)
- [ ] **SLCK-05**: Follow-up context and status updates appear as threaded replies under the original escalation message
- [ ] **SLCK-06**: User can respond with free-form text in thread and Claude receives it as context

### Response Routing

- [ ] **IPC-01**: MCP server exposes local HTTP bridge endpoint for hook script communication (separate from stdio MCP protocol)
- [ ] **IPC-02**: SQLite state store (better-sqlite3) tracks pending escalations by correlation ID with timestamps
- [ ] **IPC-03**: Hook scripts poll SQLite for user response with configurable timeout (default 10 minutes for PermissionRequest)
- [ ] **IPC-04**: User response from Slack routes back to Claude Code — hook exits 0 (allow) or 2 (deny) with optional JSON payload
- [ ] **IPC-05**: Graceful timeout with configurable fallback decision per event type (allow, deny, or ask-again)
- [ ] **IPC-06**: Slack interactive payloads acknowledged within 3 seconds independently of hook timeout

### Configuration

- [ ] **CFG-01**: All non-secret settings in escalate.config.json — escalation rules, channel preferences, timeout values
- [ ] **CFG-02**: Escalation triggers configurable per event type with policies: always escalate, never escalate, or conditional (pattern-based)
- [ ] **CFG-03**: Startup validation on SessionStart — verify Slack credentials, ping channel with "Escalate online" message, fail loudly if misconfigured
- [ ] **CFG-04**: All secrets via environment variables (ESCALATE_SLACK_BOT_TOKEN, ESCALATE_SLACK_APP_TOKEN) — no hardcoded credentials

### Intelligence

- [ ] **INTL-01**: Auto-approval rules match tool name patterns (e.g., auto-approve all Read tool calls)
- [ ] **INTL-02**: Auto-approval rules match file path patterns (e.g., auto-approve writes to test files)
- [ ] **INTL-03**: Audit log — append-only JSON file recording every escalation: timestamp, event type, message sent, response received, decision applied
- [ ] **INTL-04**: Quiet hours — time-based escalation suppression with configurable schedule and timezone; only critical escalations (PermissionRequest, Stop) during quiet hours
- [ ] **INTL-05**: Session summary DM on TaskCompleted or Stop — phases completed, decisions made, notable events

### Multimodal

- [ ] **MDIA-01**: Voice note interpretation — download audio from Slack thread, send to Claude API for transcription, normalize to text response
- [ ] **MDIA-02**: Emoji reaction responses — configurable emoji-to-decision mapping (e.g., checkmark = approve, X = deny)

### Platform & Plugin

- [ ] **PLAT-01**: MCP server runs with stdio transport as Claude Code plugin process
- [ ] **PLAT-02**: MessagingAdapter interface defined with sendEscalation, waitForResponse, sendFollowUp, isConnected methods
- [ ] **PLAT-03**: Slack adapter implements full MessagingAdapter interface using @slack/bolt Socket Mode
- [ ] **PLAT-04**: Plugin packaged as Claude Code plugin — plugin.json manifest, hooks.json, .mcp.json with ${CLAUDE_PLUGIN_ROOT} paths
- [ ] **PLAT-05**: All output bundled with tsup for self-contained distribution (no npm install needed post-install)
- [ ] **PLAT-06**: Aggressive TypeScript linting from day one — strict tsconfig (strict: true, noUncheckedIndexedAccess, exactOptionalPropertyTypes), ESLint with @typescript-eslint/strict, no-any rules, enforced from first commit

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multimodal

- **MDIA-03**: Image/screenshot support — Claude sends visual content to Slack, user sends photos back for interpretation

### Platform Integration

- **GHUB-01**: GitHub PR/issue awareness — escalation messages include PR link, diff size, CI status when Claude is working on a PR
- **GHUB-02**: GitHub comments/discussions as an additional communication channel

### Adapters

- **ADPT-01**: Telegram adapter implementing MessagingAdapter interface
- **ADPT-02**: WhatsApp adapter implementing MessagingAdapter interface

### Dashboard

- **DASH-01**: Plugin health dashboard via Slack App Home tab — current config, recent escalation history, active session status

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time Claude output streaming to Slack | Slack rate limits (1 msg/sec) make this impossible at GSD throughput; defeats autonomous purpose |
| Natural language command parsing from Slack | Expands scope to "Slack interface to Claude" — different product entirely |
| Per-message E2E encryption | Slack Enterprise handles encryption; custom crypto adds complexity without matching threat model |
| Multi-user approval workflows | Race conditions, quorum logic, notification spam — this is PagerDuty, not a personal autonomy tool |
| Persistent message editing (live-updating Slack messages) | Edits don't re-notify on mobile; users miss updates silently |
| Mobile app | Communication happens through existing Slack app, not a custom app |
| Custom AI model hosting | Uses Claude API for media interpretation — no self-hosted models |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| — | — | Populated during roadmap creation |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 0
- Unmapped: 30 ⚠️

---
*Requirements defined: 2026-02-18*
*Last updated: 2026-02-18 after initial definition*
