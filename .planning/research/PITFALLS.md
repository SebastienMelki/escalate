# Pitfalls Research: Escalate

**Researched:** 2026-02-18
**Confidence:** HIGH (derived from Stack, Features, and Architecture research findings + Claude Code plugin documentation)

## Critical Pitfalls

### 1. Hook Script stdout Corruption
**Risk:** CRITICAL | **Phase:** 1 (Foundation)

Hook scripts communicate with Claude Code via stdin/stdout JSON. Any stray `console.log()` or shell profile output corrupts the protocol and breaks the entire hook system.

**Warning signs:**
- Hooks silently fail or return unexpected results
- Claude Code ignores hook decisions
- "JSON validation failed" errors in debug output

**Prevention:**
- Never use `console.log` in hook scripts — use `console.error` (stderr) for debug output
- Use `pino` writing to stderr for structured logging
- In MCP server, use `server.sendLoggingMessage()` for in-band logging
- Test hooks with `echo '{}' | node ./hooks/my-hook.js` to verify clean stdout

### 2. Hook-to-MCP Server IPC Channel
**Risk:** CRITICAL | **Phase:** 1-2

Hook scripts are short-lived shell processes. The MCP server is a long-lived stdio process owned by Claude Code. They cannot share stdio channels. Hooks need a separate IPC mechanism to reach the MCP server.

**Warning signs:**
- Hook scripts can't communicate with the running MCP server
- Duplicate Slack connections (one per hook invocation)
- Race conditions between concurrent hook invocations

**Prevention:**
- Use a local HTTP bridge (e.g., `localhost:PORT`) or Unix domain socket for hook→MCP communication
- Consider port conflicts: use `$CLAUDE_PROJECT_DIR/.claude/escalate.sock` instead of TCP port
- The MCP server process owns the Slack Socket Mode connection for the entire session lifetime
- Hook scripts are thin dispatchers — read stdin JSON, call MCP server HTTP endpoint, return result

### 3. Synchronous Hook Blocking for Async Slack Responses
**Risk:** CRITICAL | **Phase:** 2

Permission hooks (`PermissionRequest`, `PreToolUse`) must block Claude until the user responds on Slack. But Slack responses are async (user taps button whenever). The hook script must poll/wait for the response.

**Warning signs:**
- Hook timeouts (default 600s) before user responds
- Claude continues without waiting for approval
- Slack action acknowledgment timeout (3 seconds)

**Prevention:**
- Use SQLite (via `better-sqlite3`) as inter-process state bridge: hook writes pending escalation, polls for response; MCP server/Slack bot writes response back
- Acknowledge Slack interactive payloads within 3 seconds independently of the hook timeout
- Implement configurable timeout per escalation type (some can wait longer than others)
- Show "waiting for response" indicator to user in terminal

### 4. MCP SDK ESM-Only Constraint
**Risk:** HIGH | **Phase:** 1 (Foundation)

`@modelcontextprotocol/sdk` is ESM-only (`"type": "module"`). This affects the entire project configuration and all dependencies.

**Warning signs:**
- `ERR_REQUIRE_ESM` errors at startup
- Import resolution failures
- Hook scripts failing because they're CommonJS

**Prevention:**
- Set `"type": "module"` in `package.json`
- Use `tsup` for bundling with ESM output
- Hook scripts should be standalone compiled/bundled files, not requiring the full project
- Pin Node.js >= 22 LTS (required by `tsx` and `p-queue`)

### 5. Slack Socket Mode Lifecycle Management
**Risk:** HIGH | **Phase:** 2

Socket Mode maintains a persistent WebSocket connection. Creating/destroying it per hook invocation would be wasteful and cause connection storms.

**Warning signs:**
- Multiple WebSocket connections to Slack
- Rate limiting from Slack
- Missed interactive payloads after reconnection

**Prevention:**
- Socket Mode connection lives in the MCP server process for the entire Claude Code session
- Implement reconnection logic with exponential backoff
- Handle `SessionStart` hook to initialize and `SessionEnd` to clean up
- Single connection, message routing to correct pending escalation via correlation IDs

### 6. Plugin Distribution and Bundling
**Risk:** MEDIUM | **Phase:** 7+ (Distribution)

Claude Code copies marketplace plugins to `~/.claude/plugins/cache/`. Paths traversing outside the plugin root (`../`) won't work. Users can't run `npm install` post-install.

**Warning signs:**
- Missing `node_modules` after plugin installation
- Broken imports in cached plugin copy
- Large plugin size from bundled dependencies

**Prevention:**
- Bundle all dependencies with `tsup` into self-contained output
- Use `${CLAUDE_PLUGIN_ROOT}` for all internal paths
- Test the plugin from a cache-like location (copy to /tmp and run)
- Keep `devDependencies` separate from bundled output

### 7. Premature Adapter Abstraction
**Risk:** MEDIUM | **Phase:** 1-3

Designing the `MessagingAdapter` interface too early (before shipping Slack) risks wrong abstractions that don't fit Telegram/WhatsApp/GitHub patterns.

**Warning signs:**
- Adapter interface has Slack-specific concepts (Block Kit, threads) baked in
- Second platform requires significant adapter interface changes
- Over-abstracted message types that don't map to any real platform

**Prevention:**
- Define the `MessagingAdapter` interface but implement only Slack first
- Keep the interface minimal: `sendMessage`, `sendChoices`, `waitForResponse`, `sendMedia`
- Don't abstract platform-specific rich features (Block Kit) into the interface — let adapters handle presentation
- Refactor the interface when adding the second platform (not before)

### 8. Credential Management for Shareable Plugin
**Risk:** MEDIUM | **Phase:** 1 (Config)

Plugin must be shareable — no hardcoded Slack tokens, channels, or API keys. But credentials need to be available to both the MCP server and hook scripts.

**Warning signs:**
- Tokens committed to git
- Hook scripts can't access credentials
- Users confused about where to put their tokens

**Prevention:**
- Use environment variables for all secrets (`ESCALATE_SLACK_BOT_TOKEN`, `ESCALATE_SLACK_APP_TOKEN`, `ESCALATE_ANTHROPIC_API_KEY`)
- Provide a setup command/skill that validates credentials on first run
- Store non-secret config in `escalate.config.json` (escalation rules, channel preferences)
- Document required Slack app scopes and setup clearly in README

### 9. Claude API Audio Input Uncertainty
**Risk:** MEDIUM | **Phase:** 4 (Media)

Voice note transcription via Claude API needs verification. Claude supports image input but audio transcription path may need a fallback.

**Warning signs:**
- Voice notes fail silently
- Poor transcription quality
- High latency for audio processing

**Prevention:**
- Verify Claude API audio input capabilities before building
- Plan fallback: Whisper API or Slack's own voice-to-text
- Design media interpretation as a pluggable module (swap implementations without changing the escalation flow)

### 10. Hook Timeout vs User Response Time
**Risk:** MEDIUM | **Phase:** 2-3

Default hook timeout is 600 seconds (10 minutes). Users may not respond within that window, especially for non-urgent escalations.

**Warning signs:**
- Hooks timing out before user responds
- Claude proceeding without user input
- Lost escalation state after timeout

**Prevention:**
- Classify escalations by urgency: blocking (permission) vs informational (status update)
- For blocking escalations: implement "still waiting" pings to Slack
- For non-blocking: use async hooks (`"async": true`) that don't block Claude
- Allow configurable timeout per escalation type
- Handle timeout gracefully: notify user the escalation expired, log for retry

## Summary

| # | Pitfall | Risk | Phase |
|---|---------|------|-------|
| 1 | stdout corruption in hooks | CRITICAL | 1 |
| 2 | Hook-to-MCP IPC channel | CRITICAL | 1-2 |
| 3 | Sync hooks for async Slack | CRITICAL | 2 |
| 4 | ESM-only MCP SDK | HIGH | 1 |
| 5 | Socket Mode lifecycle | HIGH | 2 |
| 6 | Plugin bundling/distribution | MEDIUM | 7+ |
| 7 | Premature adapter abstraction | MEDIUM | 1-3 |
| 8 | Credential management | MEDIUM | 1 |
| 9 | Claude API audio uncertainty | MEDIUM | 4 |
| 10 | Hook timeout vs response time | MEDIUM | 2-3 |
