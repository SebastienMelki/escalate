# Feature Research

**Domain:** Developer notification/escalation bridge — Claude Code plugin + Slack messaging
**Researched:** 2026-02-18
**Confidence:** MEDIUM (project spec is HIGH confidence; Slack Block Kit and Claude Code hook capabilities from training data — verified against CLAUDE.md in repo, MEDIUM confidence overall due to web search restriction)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature                                     | Why Expected                                                                                                            | Complexity | Notes                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook-based event interception               | Any Claude Code plugin that "intercepts" workflow events must use the hook system. Users expect this is how it works.   | MEDIUM     | Claude Code hooks fire on `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `SubagentStop`, `TaskCompleted`, `Notification`, `SessionStart`, `SessionEnd`. Hook scripts receive JSON on stdin, return decisions via exit code + stdout JSON. Must be configured in `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` paths. |
| Slack message delivery                      | Core of the product. No message delivery = no product.                                                                  | LOW        | Requires Slack bot token + channel configuration. Use `@slack/web-api` SDK. Basic `chat.postMessage` call.                                                                                                                                                                                                                                              |
| Interactive buttons in Slack messages       | Users of Slack bots expect clickable approve/reject/decide buttons, not text instructions to reply in specific formats. | MEDIUM     | Slack Block Kit `actions` blocks with `button` elements. Requires Socket Mode or incoming webhooks for receiving interaction payloads. Interactivity must be enabled on the Slack App.                                                                                                                                                                  |
| Threaded conversation replies               | Users expect follow-up context and AI responses to appear in threads, not flooding the main channel.                    | LOW        | Slack `thread_ts` parameter on `chat.postMessage`. All related messages attach to the original escalation thread.                                                                                                                                                                                                                                       |
| Two-way communication (receive replies)     | Without receiving and acting on replies, the tool is a one-way notifier — incomplete.                                   | HIGH       | Requires persistent listener: Slack Socket Mode (WebSocket, no public URL needed) or Event Subscriptions (requires public HTTPS endpoint). Socket Mode is table stakes for local-first tool. Receiving means parsing Slack events for messages/interactions and routing to Claude.                                                                      |
| Response routing back to Claude             | Without feeding replies to Claude, the loop is broken. Core value proposition requires this.                            | HIGH       | MCP server exposes tools Claude can call. Hook script can write response to a temp file/socket/queue that a waiting process picks up. Requires a protocol for Claude to poll or wait on response.                                                                                                                                                       |
| Configuration without code changes          | Plugin must be shareable. Hardcoded tokens/channels = not usable by others.                                             | LOW        | `.env` file or `config.json` read at runtime. `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID`, `ESCALATE_USER_ID` must be configurable.                                                                                                                                                                                                        |
| Escalation trigger configuration            | Users have different risk tolerances. Some want everything escalated, some only permission requests.                    | MEDIUM     | Config file maps hook event types to escalation policies: `always`, `never`, `ask`. Users tune what gets sent to Slack vs auto-approved.                                                                                                                                                                                                                |
| Error handling / graceful degradation       | If Slack is down or misconfigured, Claude must not hang indefinitely.                                                   | MEDIUM     | Timeout on Slack response wait. Fallback behavior: auto-approve, auto-deny, or surface error inline. Config specifies timeout and fallback policy.                                                                                                                                                                                                      |
| Clear message formatting — what/why/options | Users need to understand in 3 seconds what Claude is asking and why.                                                    | MEDIUM     | Slack messages must show: context (what Claude is doing), the specific decision or question, available options, and enough detail to make a judgment call from a phone.                                                                                                                                                                                 |
| Startup validation / health check           | Users need to know the plugin is configured correctly before running a GSD session.                                     | LOW        | On `SessionStart` hook: verify Slack credentials, ping configured channel with "Escalate ready" message. Fail loudly with actionable error if misconfigured.                                                                                                                                                                                            |

---

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valued.

| Feature                                            | Value Proposition                                                                                                                                                                            | Complexity | Notes                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Voice note interpretation                          | Users can respond with a voice note from iPhone and Claude transcribes + acts on it — far lower friction than typing a considered reply while on the go.                                     | HIGH       | Slack sends audio file URL in message event. Download file using Slack Files API (requires `files:read` scope). Send audio bytes to Claude API (multimodal). Extract decision/approval from transcription. Confidence: MEDIUM — Claude API handles audio input natively. |
| Image/screenshot support (send + receive)          | Claude can send screenshots of code output, UI previews, or logs for visual verification. Users can send photos of physical interfaces or handwritten notes.                                 | HIGH       | Sending: Claude renders output, saves screenshot, uploads to Slack via `files.upload`. Receiving: Slack message with image attachment → download → send to Claude API for interpretation.                                                                                |
| Rich GSD context in messages                       | Escalation messages that include the current GSD phase, task name, what was just completed, and what's blocked give users instant situational awareness without switching to their laptop.   | MEDIUM     | Hook events contain stdin JSON with tool name, arguments, session context. Escalate parses GSD stage markers from context (phase banners, task names) and includes them in Slack message. Transforms raw event data into human-readable narrative.                       |
| Configurable auto-approval rules                   | Users can define rules ("auto-approve all Read tool calls", "auto-approve `npm install` in non-production repos") to reduce Slack noise while maintaining safety gates for risky operations. | HIGH       | Rule engine evaluates hook event JSON against user-defined patterns (tool name, argument patterns, file path patterns). Only escalate when no rule matches. Rules stored in config, hot-reloadable.                                                                      |
| Intelligent escalation suppression ("quiet hours") | During working hours users want all events. At 2am they want only critical escalations, not "Should I add a comment to this function?"                                                       | MEDIUM     | Time-based escalation policy in config. Outside quiet hours: escalate only `PermissionRequest` and `Stop` events. Inside working hours: full escalation. User can set timezone + hours.                                                                                  |
| Reaction-based quick responses                     | Instead of typing, user reacts with emoji (checkmark = approve, X = deny) for binary decisions, without opening a thread.                                                                    | MEDIUM     | Subscribe to `reaction_added` Slack events. Map emoji codes to decisions (configurable). Faster than typing from phone.                                                                                                                                                  |
| Audit log / escalation history                     | Teams running GSD autonomously need to review what decisions were made, when, and by whom.                                                                                                   | LOW        | Append-only JSON log file: timestamp, hook event type, escalation message, response received, action taken. Useful for debugging and accountability.                                                                                                                     |
| Adapter pattern for multiple platforms             | Building Slack-only now but architecting for Telegram/WhatsApp/GitHub means future users on other platforms can use the plugin without a rewrite.                                            | MEDIUM     | `MessageAdapter` interface with `sendMessage()`, `waitForReply()`, `sendFile()` methods. `SlackAdapter` implements it. Future `TelegramAdapter`, `GitHubAdapter` drop in. Core escalation logic never references Slack directly.                                         |
| GitHub PR/issue awareness as context               | If Claude is working on a PR, the Slack message can include a direct link to that PR, the diff size, CI status — giving the user full context without switching apps.                        | HIGH       | MCP tool calls `gh pr view` or GitHub API to get PR metadata. Attach to escalation message. Requires GitHub token in config. This is future-phase but architecture must not preclude it.                                                                                 |
| Plugin health dashboard (Slack home tab)           | App home tab in Slack shows current config, recent escalation history, active session status, and enable/disable toggles.                                                                    | HIGH       | Slack App Home tab with Block Kit layout. Updated via `views.publish`. Makes the bot feel like a real app, not just a webhook endpoint. This is a differentiator — few bots use App Home well.                                                                           |
| Session summary on completion                      | When Claude finishes a GSD run, send a Slack DM summarizing: phases completed, decisions made, time taken, git commits pushed.                                                               | LOW        | `TaskCompleted` or `Stop` hook triggers summary generation. Claude API generates summary from session log. One DM, not a thread.                                                                                                                                         |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature                                                   | Why Requested                                                                             | Why Problematic                                                                                                                                                                                                                                         | Alternative                                                                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-time Claude output streaming to Slack                | "I want to see what Claude is doing live" — sounds great for transparency                 | (1) Slack rate limits: 1 message/second per channel. A busy GSD run would hit limits immediately. (2) Creates enormous noise — hundreds of messages per session. (3) Defeats the purpose of autonomous operation. (4) Slack is not a terminal.          | Send structured phase-start/phase-complete summaries at milestone boundaries only. Users who need live output should watch the terminal.                                                          |
| Slack bot as primary UI for all configuration             | "Let me configure everything from Slack" — seems convenient                               | Creates two sources of truth (Slack settings vs config file). Slack modal state is ephemeral. Breaks shareable/reproducible config. Hard to version-control.                                                                                            | Config lives in a single `escalate.config.json` file. Slack shows current config (read-only) in App Home. To change config, edit file and restart.                                                |
| Per-message encryption / end-to-end encryption            | "My code decisions are sensitive" — legitimate concern                                    | Slack already encrypts in transit and at rest (Enterprise Grid adds EKM). Building custom E2E encryption on top of Slack messages is architecturally complex and unnecessary for the threat model. Slack workspace security is the right control point. | Document that users should use their org's Slack workspace (not a public one). For high-security needs, recommend self-hosted messaging (out of scope for v1).                                    |
| Multi-user approval workflows                             | "My team should all approve" — sounds like collaboration                                  | Introduces race conditions (two people approve simultaneously), quorum logic, notification spam to multiple people. Fundamentally changes the product from personal autonomy tool to team workflow tool.                                                | Keep it personal: one Slack user, one bot. If team workflows are needed, that's a separate product (PagerDuty, OpsGenie, etc).                                                                    |
| Persistent message editing (live-updating Slack messages) | "Update the message as Claude makes progress" — seems clean                               | Slack message edits do not re-notify. Users on mobile will miss updates silently. Edited messages can be confusing in history. Hard to reason about state.                                                                                              | Send a new message when status changes. Explicitly mark old message as superseded (e.g., reply in thread "Update: task completed").                                                               |
| Natural language command input from Slack                 | "Let me send Claude instructions from Slack mid-session" — desirable, but scope-expanding | Converts this from an escalation bridge into a full Slack-to-Claude interface. Significantly expands attack surface, security model, and scope. Requires Claude to parse free-form intent from Slack messages reliably.                                 | Support structured responses only: numbered option selection, "approved"/"denied", emoji reactions. Free-form text responses are forwarded verbatim to Claude as context, not parsed as commands. |
| Push notifications outside Slack                          | "Also text me or email me"                                                                | Adds platform dependencies, authentication complexity, and redundancy. Slack already sends mobile push notifications natively.                                                                                                                          | Ensure user has Slack mobile app with notifications enabled. Document this as the notification mechanism.                                                                                         |

---

## Feature Dependencies

```
[Slack message delivery]
    └──requires──> [Slack Bot Token + API config]

[Interactive buttons in messages]
    └──requires──> [Socket Mode listener] (to receive interaction payloads)
                       └──requires──> [Slack App Token (xapp-)]

[Two-way communication]
    └──requires──> [Socket Mode listener]
    └──requires──> [Slack message delivery]

[Response routing back to Claude]
    └──requires──> [Two-way communication]
    └──requires──> [MCP server running]
    └──requires──> [Hook script ↔ MCP server IPC protocol]

[Hook-based event interception]
    └──requires──> [hooks/hooks.json configured]
    └──requires──> [hook scripts executable and on PATH]
    └──requires──> [Plugin installed in Claude Code]

[Voice note interpretation]
    └──requires──> [Two-way communication]
    └──requires──> [Claude API key]
    └──requires──> [Slack files:read scope]

[Image support]
    └──requires──> [Two-way communication]
    └──requires──> [Claude API key]
    └──requires──> [Slack files:read scope]

[Rich GSD context in messages]
    └──requires──> [Slack message delivery]
    └──enhances──> [Hook-based event interception] (parses hook stdin JSON)

[Auto-approval rules]
    └──requires──> [Hook-based event interception]
    └──enhances──> [Escalation trigger configuration]

[Reaction-based quick responses]
    └──requires──> [Socket Mode listener]
    └──requires──> [Slack reactions:read scope]

[Session summary on completion]
    └──requires──> [Slack message delivery]
    └──requires──> [Claude API key] (for summary generation)

[GitHub PR/issue awareness]
    └──requires──> [GitHub token in config]
    └──requires──> [Rich GSD context in messages]
    └──enhances──> [Slack message delivery]

[Adapter pattern]
    └──enables──> [Telegram/WhatsApp adapter] (future)
    └──enables──> [GitHub adapter] (future)
```

### Dependency Notes

- **Response routing requires MCP server + IPC protocol:** This is the most architecturally complex dependency chain. The hook script (a short-lived process) must hand off to the long-running MCP server, which must provide a tool Claude can call to block-and-wait for the response. The IPC mechanism (Unix socket, temp file with polling, named pipe) is a critical design decision.
- **Socket Mode is foundational:** Interactive buttons AND reactions AND receiving replies all require Socket Mode (the persistent WebSocket listener). Attempting to do these without Socket Mode would require a public HTTPS endpoint — unacceptable for a local-first tool. Socket Mode is a prerequisite for the product working at all.
- **Claude API key is a separate credential from Slack:** Voice notes, images, and session summaries all require Claude API access. This is independent of Claude Code's own API access — the MCP server needs its own key. Must be documented clearly.
- **Auto-approval rules conflict with full escalation:** If rules are too permissive, critical escalations are suppressed. Rules must have an explicit "always escalate" override for `PermissionRequest` events involving destructive operations.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — validates the core loop: Claude stops → Slack message sent → user responds → Claude continues.

- [x] **Hook-based event interception** — The product doesn't exist without hooks. `PermissionRequest`, `PreToolUse`, `Stop`, `PostToolUseFailure` are the minimum set.
- [x] **Slack message delivery** — Send the escalation to the user's Slack channel. Plain text acceptable for v1, Block Kit preferred.
- [x] **Interactive buttons** — Approve/Deny/Snooze buttons. Without buttons, users must type responses — too slow from a phone.
- [x] **Socket Mode listener** — Required to receive button interactions and text replies. No public URL needed.
- [x] **Response routing back to Claude** — The IPC mechanism: hook script writes to socket/file, MCP server polls, Claude's `wait_for_escalation_response` tool unblocks. This is the hardest part but mandatory for v1.
- [x] **Configuration without code** — `escalate.config.json` with Slack tokens, channel ID, user ID. Must work for a second person without code changes.
- [x] **Escalation trigger configuration** — At minimum: a list of hook event types to escalate. Without this, everything escalates and it's noise.
- [x] **Startup validation** — On `SessionStart`, verify credentials and send "Escalate online" message. Users need confidence it's working before a 2-hour autonomous run.
- [x] **Graceful timeout** — If user doesn't respond within N minutes, fall back to configured default (auto-deny is safest). Claude must not hang.
- [x] **Rich GSD context in messages** — If context is missing, users can't make decisions from their phone. This is table stakes for the use case even if technically it's enrichment.

### Add After Validation (v1.x)

Features to add once the core loop is validated.

- [ ] **Voice note interpretation** — Add when users report typing responses on phone is too slow. High value, medium complexity.
- [ ] **Image support** — Add when users want visual verification (screenshots, diagrams) over Slack.
- [ ] **Auto-approval rules** — Add when users report Slack notification fatigue. Start with simple tool-name matching.
- [ ] **Reaction-based quick responses** — Add after seeing which interactions users prefer. Emoji reactions are faster than typing.
- [ ] **Session summary on completion** — Add after v1 is working reliably. Low complexity, high delight.
- [ ] **Audit log** — Add when debugging sessions become common. Low complexity, high utility.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **GitHub PR/issue awareness** — Powerful but requires GitHub token, API calls, and richer message templates. Defer until Slack loop is solid.
- [ ] **Telegram/WhatsApp adapter** — Defer until there's evidence users want alternatives to Slack. Architecture should be ready (adapter pattern), but don't build it.
- [ ] **Plugin health dashboard (App Home tab)** — High complexity Slack feature. Defer until users complain about configuration opacity.
- [ ] **Quiet hours / intelligent escalation suppression** — Useful but requires timezone handling. Defer to v1.x when users report notification fatigue.

---

## Feature Prioritization Matrix

| Feature                             | User Value               | Implementation Cost | Priority          |
| ----------------------------------- | ------------------------ | ------------------- | ----------------- |
| Hook-based event interception       | HIGH                     | MEDIUM              | P1                |
| Slack message delivery              | HIGH                     | LOW                 | P1                |
| Interactive buttons (Block Kit)     | HIGH                     | MEDIUM              | P1                |
| Socket Mode listener                | HIGH                     | MEDIUM              | P1                |
| Response routing (hook ↔ MCP IPC)   | HIGH                     | HIGH                | P1                |
| Configuration without code changes  | HIGH                     | LOW                 | P1                |
| Escalation trigger configuration    | HIGH                     | MEDIUM              | P1                |
| Startup validation / health check   | MEDIUM                   | LOW                 | P1                |
| Graceful timeout + fallback         | HIGH                     | MEDIUM              | P1                |
| Rich GSD context in messages        | HIGH                     | MEDIUM              | P1                |
| Voice note interpretation           | HIGH                     | HIGH                | P2                |
| Image support (send + receive)      | MEDIUM                   | HIGH                | P2                |
| Auto-approval rules                 | HIGH                     | HIGH                | P2                |
| Reaction-based quick responses      | MEDIUM                   | MEDIUM              | P2                |
| Session summary on completion       | MEDIUM                   | LOW                 | P2                |
| Audit log                           | MEDIUM                   | LOW                 | P2                |
| Quiet hours / time-based escalation | MEDIUM                   | MEDIUM              | P2                |
| Adapter pattern (multi-platform)    | LOW (now) / HIGH (later) | MEDIUM              | P2                |
| GitHub PR/issue awareness           | MEDIUM                   | HIGH                | P3                |
| Plugin health dashboard (App Home)  | LOW                      | HIGH                | P3                |
| Multi-user approval workflows       | LOW                      | HIGH                | P3 — anti-feature |
| Real-time output streaming          | LOW                      | MEDIUM              | Anti-feature      |

**Priority key:**

- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature                       | PagerDuty / OpsGenie                             | Zapier / n8n automations         | Linear / GitHub Notifications | Our Approach                                                                                       |
| ----------------------------- | ------------------------------------------------ | -------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Escalation triggers           | Alert severity rules, on-call schedules          | Workflow triggers (event-based)  | PR review requests, mentions  | Hook event types + configurable policy — tuned to Claude Code's specific decision points           |
| Interactive response          | Acknowledge, resolve buttons                     | Static webhooks (one-way mostly) | Comment on PR (async)         | Approve/deny/snooze buttons + text reply + emoji reactions in-thread                               |
| AI interpretation of response | No                                               | No                               | No                            | Voice notes + images interpreted by Claude API — unique to this tool                               |
| Context richness              | Service, alert severity, runbook link            | Template-based                   | PR title, diff, CI status     | GSD phase, task name, hook event details, what Claude was about to do — developer-specific context |
| Two-way routing to automator  | No (alerts go to humans, not back to automation) | Partial (webhooks)               | No                            | Complete: response feeds directly back to Claude and unblocks the autonomous run                   |
| Local-first operation         | Cloud-only                                       | Cloud-only                       | Cloud-only                    | Socket Mode — no public URL needed, runs on developer's machine                                    |
| Developer tool awareness      | Generic                                          | Generic                          | GitHub-specific               | Claude Code hook system native — understands `PreToolUse`, `PermissionRequest`, GSD concepts       |

**Differentiation summary:** No existing tool combines (1) native Claude Code event interception, (2) interactive Slack UX with binary + freeform responses, (3) AI interpretation of unstructured human replies (voice/image), and (4) bidirectional routing that unblocks autonomous AI runs. The closest analogs are on-call escalation tools (PagerDuty) but those never route decisions back to automated systems — they only page humans. This product closes that loop.

---

## Sources

- **Project spec (`.planning/PROJECT.md`):** Requirements, constraints, key decisions — HIGH confidence
- **CLAUDE.md (in-repo):** Claude Code hook event types, hook JSON protocol, plugin structure — HIGH confidence (official project documentation)
- **GSD checkpoints reference (`~/.claude/get-shit-done/references/checkpoints.md`):** Checkpoint types (human-verify, decision, human-action), GSD decision point patterns — HIGH confidence (directly relevant to what gets escalated)
- **Slack Block Kit (training data):** Block Kit component types, Socket Mode, interaction payloads, file APIs — MEDIUM confidence (verified against known Slack SDK v3 patterns; web search restricted)
- **Competitor analysis (training data):** PagerDuty, OpsGenie, Zapier feature sets — MEDIUM confidence (general feature landscape, not specific pricing/availability)
- **Claude API multimodal (training data):** Audio and image input support — MEDIUM confidence (Claude API supports image input as of Claude 3 models; audio transcription via multimodal — verify against current Claude API docs before implementation)

---

_Feature research for: Escalate — Claude Code plugin + Slack escalation bridge_
_Researched: 2026-02-18_
