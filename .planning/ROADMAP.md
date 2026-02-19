# Roadmap: Escalate

## Overview

Escalate is built bottom-up along the dependency graph: shared types and ESM foundation first, then the IPC mechanism (SQLite + HTTP bridge), then the Slack adapter in isolation, then hook scripts as thin dispatchers on top of all prior work, then intelligence/context features that make messages actionable, then multimodal response support, and finally plugin packaging for distribution. Each phase delivers a complete, testable capability. The first four phases produce a working end-to-end escalation loop; phases 5-7 make it smart, multimodal, and distributable.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - ESM project skeleton, shared types, config schema, MessagingAdapter interface, strict TypeScript linting
- [x] **Phase 2: State Store and IPC Bridge** - SQLite state store for pending escalations, MCP server with HTTP bridge endpoint, polling-based response resolution (completed 2026-02-19)
- [ ] **Phase 3: Slack Adapter** - Socket Mode connection, Block Kit messages with interactive buttons, threaded replies, startup validation
- [x] **Phase 4: Hook Scripts and Escalation Loop** - Thin hook dispatchers for all four event types, full end-to-end escalation round-trip, configurable timeouts (completed 2026-02-19)
- [x] **Phase 5: Escalation Intelligence** - Auto-approval rules, rich GSD context in messages, audit logging, quiet hours, session summaries (completed 2026-02-19)
- [ ] **Phase 6: Multimodal Responses** - Voice note transcription via Claude API, emoji reaction mapping
- [ ] **Phase 7: Plugin Packaging** - tsup bundling, plugin.json manifest, .mcp.json with CLAUDE_PLUGIN_ROOT paths, self-contained distribution

## Phase Details

### Phase 1: Foundation

**Goal**: A working ESM TypeScript project with shared types, config loading, and strict linting that all downstream phases build on
**Depends on**: Nothing (first phase)
**Requirements**: PLAT-02, PLAT-06, CFG-01, CFG-04
**Success Criteria** (what must be TRUE):

1. Running `npm run build` produces ESM output via tsup without errors
2. TypeScript strict mode with noUncheckedIndexedAccess and exactOptionalPropertyTypes catches type errors at compile time
3. ESLint with @typescript-eslint/strict and no-any rules rejects unsafe code
4. The MessagingAdapter interface is defined with sendEscalation, waitForResponse, sendFollowUp, and isConnected methods
5. An escalate.config.json file can be loaded and validated against a Zod schema, with all secrets read from environment variables
   **Plans**: 3 plans

Plans:

- [x] 01-01-PLAN.md — ESM project skeleton, strict tooling, core types, MessagingAdapter interface, Result type
- [x] 01-02-PLAN.md — Config schema validation and loading with TDD (Zod 4, env var secrets)
- [x] 01-03-PLAN.md — Gap closure: .prettierignore and PLAT-01 requirement reassignment to Phase 2

### Phase 2: State Store and IPC Bridge

**Goal**: Hook scripts and the MCP server can exchange escalation state through SQLite, with the MCP server exposing a local HTTP endpoint for hook communication
**Depends on**: Phase 1
**Requirements**: PLAT-01, IPC-01, IPC-02, IPC-03, IPC-05
**Success Criteria** (what must be TRUE):

1. The MCP server starts via stdio transport and simultaneously exposes an HTTP endpoint on a configurable port
2. A pending escalation can be created in SQLite with a correlation ID and retrieved by that ID
3. A hook script can POST to the HTTP bridge to create an escalation, then poll GET until a response appears or timeout expires
4. When timeout expires without a response, a configurable fallback decision (allow/deny/ask-again) is returned
   **Plans**: 2 plans

Plans:

- [x] 02-01-PLAN.md — SQLite state store with escalation CRUD, fallback decision config (TDD)
- [x] 02-02-PLAN.md — MCP server (stdio), HTTP bridge, server entrypoint, plugin config

### Phase 3: Slack Adapter

**Goal**: Users receive rich interactive escalation messages on their phone via Slack and can respond with buttons or text in threads
**Depends on**: Phase 2
**Requirements**: SLCK-01, SLCK-02, SLCK-03, SLCK-04, SLCK-05, SLCK-06, PLAT-03, CFG-03
**Success Criteria** (what must be TRUE):

1. The MCP server maintains a persistent Slack Socket Mode WebSocket connection that survives disconnects with automatic reconnection
2. Sending an escalation produces a Block Kit message in the configured Slack channel with title, context, question, and Approve/Deny/Snooze buttons
3. Tapping a button in Slack resolves the corresponding pending escalation in SQLite within 3 seconds of the tap
4. Typing a free-form text reply in the escalation thread resolves the pending escalation with the user's message as context
5. On SessionStart, the plugin sends an "Escalate online" message to the configured channel and fails loudly if Slack credentials are invalid
   **Plans**: 2 plans

Plans:

- [x] 03-01-PLAN.md — Block Kit message builder, Slack types, and unit tests
- [x] 03-02-PLAN.md — SlackAdapter class, handlers, server integration, startup validation

### Phase 4: Hook Scripts and Escalation Loop

**Goal**: Claude Code events trigger escalations through Slack and user responses flow back as hook decisions, completing the full autonomous loop
**Depends on**: Phase 3
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, IPC-04, IPC-06
**Success Criteria** (what must be TRUE):

1. A PermissionRequest event triggers a Slack message; tapping Approve lets Claude proceed (exit 0) and tapping Deny blocks it (exit 2)
2. A PreToolUse event for a dangerous tool triggers an escalation before the tool executes
3. A Stop event asks the user about next steps before the session ends
4. A PostToolUseFailure event notifies the user of the failure in Slack
5. Each hook script is under 50 lines, delegating all logic to the MCP server via HTTP
   **Plans**: 2 plans

Plans:

- [x] 04-01-PLAN.md — Shared bridge client library and HTTP bridge Slack adapter integration
- [x] 04-02-PLAN.md — Four hook scripts, hooks.json manifest, tsup config, and unit tests

### Phase 5: Escalation Intelligence

**Goal**: The plugin reduces notification noise through auto-approval rules and provides enough context in messages for users to make informed decisions from their phone
**Depends on**: Phase 4
**Requirements**: CFG-02, INTL-01, INTL-02, INTL-03, INTL-04, INTL-05
**Success Criteria** (what must be TRUE):

1. Auto-approval rules matching tool name patterns (e.g., "Read") silently approve without escalating to Slack
2. Auto-approval rules matching file path patterns (e.g., test files) silently approve writes without escalating
3. Every escalation event is recorded in an append-only audit log with timestamp, event type, message sent, response received, and decision applied
4. During configured quiet hours, only critical escalations (PermissionRequest, Stop) are sent; others are auto-handled per fallback policy
5. On TaskCompleted or Stop, a session summary DM is sent listing phases completed, decisions made, and notable events
   **Plans**: 3 plans

Plans:

- [ ] 05-01-PLAN.md — Auto-approval rules, quiet hours, config schema extension (TDD)
- [ ] 05-02-PLAN.md — Audit log writer/reader, session summary builder (TDD)
- [ ] 05-03-PLAN.md — HTTP bridge intelligence integration, TaskCompleted hook, summary dispatch

### Phase 6: Multimodal Responses

**Goal**: Users can respond to escalations with voice notes or emoji reactions instead of typing, and the plugin interprets these as actionable decisions
**Depends on**: Phase 5
**Requirements**: MDIA-01, MDIA-02
**Success Criteria** (what must be TRUE):

1. A voice note sent in a Slack escalation thread is downloaded, sent to Claude API for transcription, and the transcribed text resolves the pending escalation
2. An emoji reaction on an escalation message (e.g., checkmark = approve, X = deny) resolves the pending escalation according to a configurable mapping
   **Plans**: TBD

Plans:

- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Plugin Packaging

**Goal**: The plugin is a self-contained, installable Claude Code plugin that anyone can configure with their own Slack workspace
**Depends on**: Phase 6
**Requirements**: PLAT-04, PLAT-05
**Success Criteria** (what must be TRUE):

1. Running tsup produces a self-contained dist/ bundle with no runtime dependency on node_modules
2. The plugin installs in Claude Code via plugin.json manifest with all paths using ${CLAUDE_PLUGIN_ROOT}
3. Copying the plugin to a fresh directory and running `claude --plugin-dir .` starts the MCP server and registers all hooks without errors
   **Plans**: TBD

Plans:

- [ ] 07-01: TBD
- [ ] 07-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase                               | Plans Complete | Status      | Completed |
| ----------------------------------- | -------------- | ----------- | --------- |
| 1. Foundation                       | 3/3            | Complete    | 2026-02-18 |
| 2. State Store and IPC Bridge       | 2/2            | Complete    | 2026-02-19 |
| 3. Slack Adapter                    | 2/2            | Complete    | 2026-02-19 |
| 4. Hook Scripts and Escalation Loop | 0/2            | Complete    | 2026-02-19 |
| 5. Escalation Intelligence          | 0/3            | Complete    | 2026-02-19 |
| 6. Multimodal Responses             | 0/2            | Not started | -         |
| 7. Plugin Packaging                 | 0/2            | Not started | -         |
