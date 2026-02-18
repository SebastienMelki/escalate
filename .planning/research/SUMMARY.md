# Project Research Summary

**Project:** Escalate — Claude Code plugin + MCP server + Slack escalation bridge
**Domain:** Developer autonomy tool — bidirectional human-in-the-loop escalation for AI coding agents
**Researched:** 2026-02-18
**Confidence:** HIGH (stack verified against live npm registry; architecture verified against first-party plugin examples)

## Executive Summary

Escalate is a Claude Code plugin that intercepts hook events (PermissionRequest, PreToolUse, Stop, PostToolUseFailure), routes escalations to a user's Slack workspace via interactive Block Kit messages, waits for the user's response (button tap, text reply, voice note, or emoji reaction), and feeds the decision back to Claude Code to unblock the autonomous run. The product's core value is closing a loop that no existing tool closes: autonomous AI operations can now pause, surface decisions to a human on their phone, and resume with the human's input — without the developer needing to be at their desk. Building this requires orchestrating three process boundaries (Claude Code hook scripts, a long-lived MCP server, and a Slack bot), which is the primary architectural challenge.

The recommended approach is a local-first, stdio-based MCP server using Socket Mode for Slack — no public URLs, no ngrok, no cloud infrastructure required for v1. The critical architectural decision is the inter-process communication (IPC) mechanism between short-lived hook scripts and the long-running MCP server: a local HTTP bridge (e.g., `localhost:7842`) with SQLite as the shared state store. The hook script blocks on a polling loop, the MCP server owns the Slack connection, and SQLite is the handoff point when the user responds. This pattern avoids the three most critical failure modes identified in research.

The key risks are all concentrated in the hook-to-MCP integration layer. stdout corruption in hook scripts silently breaks the entire hook system; using the wrong IPC channel (stdio instead of HTTP) blocks both Claude Code and the MCP server; and failing to acknowledge Slack interactive payloads within 3 seconds causes Slack to retry, creating duplicate escalations. All three are avoidable with established patterns, and the architecture research provides concrete code examples for each. Build the foundation layer (ESM config, types, state store, adapter interface) before writing a single hook script — the hook scripts are the thinnest, last-built component, not the first.

---

## Key Findings

### Recommended Stack

The stack is fully ESM-native, centered on `@modelcontextprotocol/sdk@1.27.0` (stdio transport for Claude Code plugin), `@slack/bolt@4.6.0` (Socket Mode for local-first Slack), and `better-sqlite3@12.6.2` as the IPC state bridge between hook scripts and the MCP server. TypeScript 5.9.3 with `"module": "NodeNext"` is mandatory — not optional — because the MCP SDK is ESM-only and mixing CJS breaks imports. Node.js >=22 LTS is the minimum engine requirement (driven by `tsx` and `p-queue`, which both reject Node 18). All versions are verified against the live npm registry.

The most important stack decision is to reject `ts-node` (poor ESM support), `SSEServerTransport` (deprecated), `console.log` in hook scripts (corrupts stdio protocol), and per-hook Slack connections (Socket Mode requires a persistent WebSocket, not a connection-per-invocation). The replacement for `ts-node` is `tsx` for dev and `tsup` for production bundling. All final output must be ESM bundles — hook scripts can use `.cjs` extension if needed but the MCP server must be pure ESM.

**Core technologies:**
- `@modelcontextprotocol/sdk@1.27.0`: MCP server (stdio transport) — official Anthropic SDK, McpServer high-level API
- `@slack/bolt@4.6.0`: Slack bot framework (Socket Mode) — official SDK, handles OAuth + interactive components
- `better-sqlite3@12.6.2`: IPC state store — synchronous API ideal for hook polling loop, zero config
- `zod@4.3.6`: Schema validation — MCP SDK peer dependency, validates hook stdin payloads and tool inputs
- `@anthropic-ai/sdk@0.76.0`: Claude API client — for voice note transcription and image interpretation
- `p-queue@9.1.0`: Async queue — manages concurrent escalations from multiple Claude sessions
- `pino@10.3.1`: Structured logging — writes to stderr only, never corrupts MCP stdio protocol
- `tsx@4.21.0` + `tsup@8.5.1`: Dev runner + bundler — ESM-native, esbuild-based, replaces ts-node

### Expected Features

The research draws a clear line between what is mandatory for v1 (the core escalation loop) and what is dangerous to build now (multi-user workflows, streaming Claude output to Slack, natural language command parsing). The MVP must validate one loop: Claude stops → Slack message sent → user responds → Claude continues.

**Must have (P1 — v1 launch):**
- Hook-based event interception — `PermissionRequest`, `PreToolUse`, `Stop`, `PostToolUseFailure` minimum event set
- Slack message delivery with Block Kit formatting — plain text is not acceptable UX for phone-based decisions
- Interactive buttons (Approve/Deny/Snooze) — without buttons users must type; too slow from a phone
- Socket Mode listener — prerequisite for receiving button interactions and text replies without a public URL
- Response routing back to Claude (hook IPC mechanism) — the hardest feature, but non-negotiable for v1
- Escalation trigger configuration — without this, everything escalates and it becomes noise
- Graceful timeout with configurable fallback — Claude must never hang indefinitely
- Rich GSD context in messages — users cannot make decisions from a phone without knowing what Claude was about to do
- Startup validation on SessionStart — users need confidence before a 2-hour autonomous run
- Config without code changes — `escalate.config.json` for tokens, channels, escalation rules

**Should have (P2 — v1.x after validation):**
- Voice note interpretation (Claude API multimodal) — lowest friction response from mobile
- Emoji reaction responses (`reaction_added` events) — even faster than buttons for binary decisions
- Auto-approval rules (tool name / path pattern matching) — reduces Slack noise as usage scales
- Session summary on TaskCompleted — low complexity, high delight
- Audit log — append-only JSON; essential for debugging autonomous runs
- Quiet hours / time-based escalation suppression — defer until users report notification fatigue

**Defer (v2+):**
- GitHub PR/issue awareness as context — powerful but requires GitHub token and adds API complexity
- Telegram/WhatsApp/GitHub adapter implementations — architecture must be ready (adapter pattern), but don't build yet
- Plugin health dashboard (Slack App Home tab) — high Slack complexity, low v1 priority
- Multi-user approval workflows — this is a different product (PagerDuty), not a personal autonomy tool

**Anti-features (do not build):**
- Real-time Claude output streaming to Slack — Slack rate limits (1 msg/sec) make this impossible at GSD throughput
- Natural language command parsing from Slack — expands scope to "Slack interface to Claude", which is a different product
- Per-message E2E encryption — Slack Enterprise handles this; custom crypto adds complexity without threat-model benefit

### Architecture Approach

The system has four process boundaries: Claude Code (host), hook scripts (short-lived subprocesses called per event), MCP server (long-lived stdio process managed by Claude Code), and the Slack platform (external WebSocket via Socket Mode). The architectural mandate is: hook scripts are thin dispatchers (50 lines max), all business logic lives in the MCP server's messaging engine, the Slack Socket Mode connection is owned exclusively by the MCP server, and SQLite is the IPC handoff point for responses. The hook script cannot share stdio with the MCP server — Claude Code owns both channels separately. A local HTTP bridge on the MCP server side solves this cleanly.

**Major components:**
1. `hooks/hooks.json` + `scripts/` — Event entry points; thin dispatchers; read config, decide escalate/pass, call MCP HTTP bridge, return decision via exit code
2. `servers/escalate-mcp.ts` — Long-lived MCP server (stdio); owns Slack Socket Mode connection; exposes `escalate()`, `check_pending()`, `configure()` tools to Claude LLM and HTTP bridge to hook scripts
3. `src/messaging/engine.ts` — Escalation engine; applies trigger config; routes to adapter; manages pending escalation state
4. `src/messaging/adapters/interface.ts` + `adapters/slack/` — Platform adapter pattern; `MessagingAdapter` interface defined first; Slack implementation built next; Telegram/GitHub slots in later without engine changes
5. `src/messaging/state.ts` — SQLite state store via `better-sqlite3`; tracks pending escalations and incoming responses; the IPC handoff point
6. `src/claude-client.ts` — Claude API client; used only for voice note transcription and image interpretation

**Build order (dependency-driven):**
Config schema → `MessagingAdapter` interface + types → SQLite state store → Slack adapter → Claude API client → Escalation engine → MCP server (with HTTP bridge) → Hook scripts → `hooks.json` + `plugin.json` → Integration test of full escalation round-trip

### Critical Pitfalls

1. **stdout corruption in hook scripts** — Any `console.log()` in a hook script corrupts the Claude Code JSON protocol silently. Use `console.error()` or `pino` to stderr exclusively. Test every hook with `echo '{}' | node ./scripts/my-hook.js` to verify clean stdout.

2. **Hook-to-MCP IPC via stdio** — Hook scripts cannot share stdio with the MCP server (Claude Code owns both channels separately). Use a local HTTP bridge (`localhost:PORT` or Unix domain socket at `$CLAUDE_PROJECT_DIR/.claude/escalate.sock`). Port conflicts are real — prefer Unix sockets.

3. **Synchronous hook blocking for async Slack responses** — `PermissionRequest` hooks must block until the user responds, but Slack responses arrive asynchronously. SQLite polling (`better-sqlite3` every 2s, configurable timeout) is the solution. Slack interactive payloads must be acknowledged within 3 seconds independently of the hook wait — decouple acknowledgment from resolution.

4. **ESM-only MCP SDK breaking the entire project** — `@modelcontextprotocol/sdk` is ESM-only. Set `"type": "module"` in `package.json` immediately. Configure `tsup` for ESM output. Pin Node >=22 LTS. Never use `require()` or `ts-node`. This must be the first decision, not an afterthought.

5. **One Slack Socket Mode connection per hook invocation** — Socket Mode is a persistent WebSocket. Creating/destroying it per hook invocation causes connection storms and misses incoming interactive payloads. The MCP server owns one Socket Mode connection for the entire Claude Code session lifetime. Hook scripts call into it via HTTP.

---

## Implications for Roadmap

Based on the dependency graph from architecture research and pitfall phase mappings, the natural build order is:

### Phase 1: Foundation — ESM Project Skeleton + Types + Config

**Rationale:** Everything else depends on getting ESM right and the shared types defined. ESM misconfiguration (pitfall #4) silently breaks all downstream work. The `MessagingAdapter` interface must exist before any Slack code is written. Config loader must exist before any hook script is written.

**Delivers:** Working TypeScript ESM project with `tsup` bundling, shared types (`EscalationRequest`, `UserResponse`, `MessagingAdapter` interface), `escalate.config.json` schema + loader, and credential environment variable pattern.

**Addresses:** Hook-based event interception scaffold, configuration without code changes, startup validation skeleton.

**Avoids:** ESM pitfall (#4), credential management pitfall (#8), premature adapter abstraction pitfall (#7 — interface defined once, here, and never changed until second platform exists).

**Research flag:** Standard patterns — well-documented ESM/TypeScript setup, skip research-phase for this phase.

---

### Phase 2: SQLite State Store + HTTP Bridge

**Rationale:** The IPC mechanism between hook scripts and the MCP server is the architectural lynchpin. Without it, neither hooks nor the MCP server can be built correctly. SQLite state store + local HTTP bridge must be proven in isolation before Slack or hooks are layered on top.

**Delivers:** `better-sqlite3` state store tracking pending escalations by correlation ID; MCP server with HTTP bridge endpoint; hook-to-MCP HTTP client; polling loop for response resolution.

**Addresses:** Response routing back to Claude (core IPC mechanism).

**Avoids:** Hook-to-MCP IPC pitfall (#2), synchronous blocking pitfall (#3 — the polling pattern is built here).

**Research flag:** Standard patterns for SQLite polling — skip research-phase. HTTP bridge port vs Unix socket decision is a minor implementation choice.

---

### Phase 3: Slack Adapter + Socket Mode + Block Kit Messages

**Rationale:** With the state store and IPC bridge in place, the Slack adapter can be developed and tested in isolation against the `MessagingAdapter` interface. Socket Mode lifecycle management (pitfall #5) is contained here. The Slack adapter is the most complex single component; isolating it prevents it from contaminating other layers.

**Delivers:** `@slack/bolt` Socket Mode connection (owned by MCP server); `slack-block-builder` Block Kit messages with Approve/Deny/Snooze buttons; interactive payload handlers that write responses to SQLite; thread-based conversation replies; startup "Escalate online" validation message.

**Addresses:** Slack message delivery, interactive buttons, Socket Mode listener, startup validation, threaded replies.

**Avoids:** Socket Mode lifecycle pitfall (#5 — one connection, reconnection with backoff), Slack interactive payload 3-second acknowledgment requirement.

**Research flag:** Slack Socket Mode + Block Kit patterns are well-documented. Skip research-phase unless interactive payload routing proves complex.

---

### Phase 4: Hook Scripts + Full Escalation Loop

**Rationale:** Hook scripts are built last because they are the thinnest layer — 50 lines each — and depend on all prior phases. Building hooks before the MCP server HTTP bridge is ready leads to hook scripts that contain business logic (anti-pattern #1 from architecture research). With phases 1-3 complete, hook scripts are trivial dispatchers.

**Delivers:** `hooks/hooks.json` registration, `scripts/on-permission-request.ts`, `scripts/on-pre-tool-use.ts`, `scripts/on-stop.ts`, `scripts/on-post-tool-failure.ts`; full end-to-end escalation round-trip working from a real Claude Code session; configurable timeout with fallback decision; graceful degradation if Slack is unreachable.

**Addresses:** Hook-based event interception, two-way communication, response routing, graceful timeout, rich GSD context in messages.

**Avoids:** stdout corruption pitfall (#1 — hook scripts use pino to stderr only), hook timeout pitfall (#10 — configurable timeout per event type implemented here).

**Research flag:** Needs validation of hook stdin JSON shape for each event type against live Claude Code behavior. Recommend `/gsd:research-phase` for real hook payload formats before implementation.

---

### Phase 5: Rich Context + Escalation Intelligence

**Rationale:** The core loop (phases 1-4) delivers a working product. This phase makes it a good product — messages that give users enough context to make decisions from their phone, and auto-approval rules that reduce noise. These require the core loop to exist first.

**Delivers:** Hook event JSON parser that extracts GSD phase, task name, and current action context; escalation trigger configuration (per-event-type policy: `always`, `never`, `ask`); auto-approval rule engine (tool name patterns, file path patterns); hot-reloadable config; escalation history/audit log.

**Addresses:** Escalation trigger configuration (full implementation), rich GSD context in messages, auto-approval rules (P2), audit log (P2).

**Research flag:** Standard patterns — config file design and pattern matching are solved problems. Skip research-phase.

---

### Phase 6: Voice Notes + Emoji Reactions + Session Summary

**Rationale:** Multimodal responses (voice, emoji) are P2 differentiators that require the complete loop from phases 1-5. Voice note transcription has an unresolved dependency (Claude API audio input needs verification — pitfall #9). Emoji reactions are lower risk (Slack `reaction_added` events are standard).

**Delivers:** Voice note download + Claude API multimodal transcription + response normalization; emoji reaction mapping (configurable); session summary DM on `TaskCompleted`/`Stop`.

**Addresses:** Voice note interpretation, reaction-based quick responses, session summary on completion (all P2).

**Avoids:** Claude API audio uncertainty pitfall (#9 — verify before building; design as pluggable module with Whisper fallback).

**Research flag:** NEEDS `/gsd:research-phase` — verify current Claude API audio input support before building. Also verify Slack `files:read` scope behavior for voice note downloads.

---

### Phase 7: Plugin Packaging + Distribution

**Rationale:** Distribution concerns (bundling, path resolution, `${CLAUDE_PLUGIN_ROOT}`) are separated from functionality to avoid premature optimization. All functionality must be working before packaging is attempted. This is pitfall #6.

**Delivers:** `tsup` bundle configuration producing self-contained `dist/` output; `plugin.json` manifest; `.mcp.json` with correct `${CLAUDE_PLUGIN_ROOT}` paths; `hooks/hooks.json` with plugin-relative paths; installation documentation; credentials setup guide with required Slack app scopes.

**Addresses:** Plugin distribution pitfall (#6), credential management documentation.

**Research flag:** Standard patterns — Claude Code plugin packaging is well-documented in marketplace plugin examples. Skip research-phase.

---

### Phase Ordering Rationale

- **Phases 1-2 before 3-4:** ESM project config and IPC mechanism must be solved before any Slack or hook code is written. Fixing ESM after Slack is integrated is extremely painful.
- **Phase 3 before 4:** Slack adapter must work in isolation before hook scripts call into it. This keeps the adapter testable independently.
- **Phase 4 last among core phases:** Hook scripts are the entry point but the last thing built. They are thin by design — 50 lines calling already-built infrastructure.
- **Phase 5 after Phase 4:** Escalation intelligence depends on the loop working. Auto-approval rules before the loop = premature optimization.
- **Phase 6 after Phase 5:** Voice notes require verified Claude API audio support. Build the fallback (Whisper) first if unverified.
- **Phase 7 last:** Packaging is a release concern, not a development concern.

### Research Flags

**Needs `/gsd:research-phase` during planning:**
- **Phase 4 (Hook Scripts):** Verify exact JSON shape of each hook event type (PermissionRequest, PreToolUse, PostToolUseFailure, Stop) against live Claude Code behavior. Training data may not reflect current format.
- **Phase 6 (Voice Notes):** Verify Claude API audio input support (`@anthropic-ai/sdk@0.76.0` — does `messages` endpoint accept audio content blocks?). If not, design Whisper API fallback.

**Standard patterns (skip research-phase):**
- **Phase 1:** ESM TypeScript + tsup setup is extremely well-documented.
- **Phase 2:** SQLite polling + local HTTP bridge is a standard IPC pattern.
- **Phase 3:** Slack Socket Mode + Block Kit is well-documented in Bolt v4 docs.
- **Phase 5:** Config file design + pattern matching are solved problems.
- **Phase 7:** Claude Code plugin packaging is documented in marketplace plugin examples.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified against live npm registry; MCP SDK internals read from installed source in `~/.npm`; Claude Code plugin patterns verified from first-party marketplace plugin examples |
| Features | MEDIUM | Project spec and CLAUDE.md are HIGH confidence; Slack Block Kit patterns from training data (MEDIUM); Claude API audio input support unverified — needs Phase 6 validation |
| Architecture | HIGH | Derived from first-party plugin documentation, real marketplace plugin examples (hookify, ralph-loop), and CLAUDE.md; IPC pattern is well-established |
| Pitfalls | HIGH | Derived directly from stack/architecture research + first-party plugin examples; not theoretical — based on actual protocol and SDK constraints |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude API audio input support:** FEATURES.md flags this as MEDIUM confidence. Before Phase 6, verify that `@anthropic-ai/sdk@0.76.0` accepts audio content in the `messages` endpoint. If not, plan Whisper API as primary transcription method. Design the media interpretation module as a pluggable backend regardless.

- **Hook event JSON schemas:** Architecture research provides general patterns but exact JSON field names for each hook event type (especially `PermissionRequest` with its `toolInput` shape) should be validated against a live Claude Code session before Phase 4 implementation begins.

- **Slack App setup complexity:** Credential management research identifies required scopes but does not enumerate the exact Slack App configuration steps (enabling Socket Mode, adding scopes, generating app token). This should be documented as a setup guide before the plugin is shareable.

- **HTTP bridge port vs Unix socket:** Architecture research recommends a local HTTP bridge but notes port conflict risk. The decision between `localhost:PORT` and a Unix domain socket at `$CLAUDE_PROJECT_DIR/.claude/escalate.sock` should be made in Phase 2 and documented.

---

## Sources

### Primary (HIGH confidence)

- `npm show @modelcontextprotocol/sdk --json` — version 1.27.0, ESM-only constraint, McpServer API, StdioServerTransport/StreamableHTTPServerTransport
- `~/.npm/_npx/.../node_modules/@modelcontextprotocol/sdk/dist/esm/server/` — verified TypeScript `.d.ts` files for McpServer, StdioServerTransport, StreamableHTTPServerTransport
- `npm show @slack/bolt --json` — version 4.6.0, Socket Mode, engine requirements
- `npm show @slack/web-api`, `better-sqlite3`, `p-queue`, `tsx`, `tsup`, `vitest`, `pino` — all versions and engine requirements verified
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/SKILL.md` — hook types, events, input/output formats, hooks.json wrapper format
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/mcp-integration/SKILL.md` — MCP server types, stdio process lifecycle
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/` — real hook plugin example
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/` — real Stop hook example
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.mcp.json` — confirmed command/args stdio pattern for Claude Code MCP
- `CLAUDE.md` (project root) — Claude Code plugin conventions, hook events, stdin/stdout protocol
- `.planning/PROJECT.md` — project requirements, constraints, key decisions

### Secondary (MEDIUM confidence)

- Slack Block Kit component types, Socket Mode, interaction payloads — training data (Slack Bolt v4 patterns)
- Competitor analysis (PagerDuty, OpsGenie, Zapier, Linear) — feature landscape, not specific pricing/availability
- GSD checkpoints reference (`~/.claude/get-shit-done/references/checkpoints.md`) — GSD checkpoint types relevant to escalation triggers

### Tertiary (LOW confidence / needs validation)

- Claude API audio input via `@anthropic-ai/sdk@0.76.0` — multimodal audio content blocks — needs verification before Phase 6 implementation
- Exact JSON field shapes for each Claude Code hook event type — general patterns known, specific field names need live validation

---

*Research completed: 2026-02-18*
*Ready for roadmap: yes*
