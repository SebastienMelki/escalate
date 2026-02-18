# Phase 1: Foundation - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

A working ESM TypeScript project with shared types, config loading, and strict linting that all downstream phases build on. This phase produces the project skeleton, core type definitions (including the escalation data shape and MessagingAdapter interface), config schema with Zod validation, and tooling setup. No runtime functionality — just the foundation everything else imports from.

</domain>

<decisions>
## Implementation Decisions

### Config design
- Config file location: Claude's discretion (pick based on Claude Code plugin conventions)
- Moderate configurability in v1: Slack config + timeouts + which events to escalate — enough to customize behavior, sensible defaults for everything else
- Secrets (Slack tokens, API keys) always come from environment variables — config file never contains secrets
- Single config, one Slack workspace — no profile switching in v1

### Escalation data shape
- 3 urgency tiers: info / warning / critical — affects display and quiet hours filtering
- Rich context in escalations: event type + question + tool name + file paths + recent task context — enough to decide from your phone
- Escalations define suggested actions (e.g., approve/deny/snooze) AND accept free-form text as fallback — typed actions with free-form escape hatch

### Error handling patterns
- Adapter failure reporting strategy: Claude's discretion (pick based on TypeScript best practices)
- When Slack is unreachable: queue escalations locally, retry when connection restores
- If all retries exhaust: always block — if we can't reach the human, Claude can't proceed (safety first)
- Error verbosity/debug context level: Claude's discretion

### Project conventions
- Source organized by grouped modules: src/config/, src/adapters/, src/types/, src/hooks/ — organized by domain from the start
- Test framework: Vitest (ESM-native, fast, Jest-compatible API)
- Package manager: pnpm
- Formatting: Prettier for formatting + ESLint for logic rules

### Claude's Discretion
- Config file location (based on plugin conventions)
- Error handling pattern (Result types vs exceptions)
- Error verbosity and debug context level
- Exact TypeScript compiler options beyond the required strict flags
- Internal module export strategy (barrel files, direct imports, etc.)

</decisions>

<specifics>
## Specific Ideas

- Escalation urgency tiers (info/warning/critical) should map naturally to Slack message styling in Phase 3
- Rich escalation context is key — the whole point is deciding from your phone without needing to SSH in
- Queue-and-retry for Slack disconnects, but always block as final fallback — never silently auto-approve when the human is unreachable

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-02-18*
