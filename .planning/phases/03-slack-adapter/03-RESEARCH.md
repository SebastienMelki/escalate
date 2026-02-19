# Phase 3: Slack Adapter - Research

**Researched:** 2026-02-19
**Domain:** Slack Bot with Socket Mode WebSocket, Block Kit interactive messages, threaded replies
**Confidence:** HIGH

## Summary

Phase 3 implements the Slack adapter that connects the existing MCP server + SQLite state store (Phase 2) to Slack. The adapter uses `@slack/bolt` 4.6.0 with Socket Mode (WebSocket), which avoids needing a public HTTP endpoint. The Bolt framework handles the WebSocket lifecycle (connection, disconnection, automatic reconnection) internally via `@slack/socket-mode`. Interactive Block Kit messages with Approve/Deny/Snooze buttons are sent to a configured channel, and user responses (button taps or free-form thread replies) resolve pending escalations in the SQLite store.

The Slack adapter implements the existing `MessagingAdapter` interface defined in Phase 1 (`src/types/adapter.ts`). It runs inside the same MCP server process (same Node.js event loop), sharing direct access to the `EscalationStore`. The Bolt App instance is created and started during server initialization, alongside the existing MCP stdio transport and HTTP bridge. On SessionStart, the plugin validates credentials via `auth.test` and posts an "Escalate online" message to the configured channel.

The primary architectural decision is that the Slack adapter lives as a module within the MCP server process -- not as a separate process. This means one WebSocket connection per Claude Code session, one process owning all state, and direct function calls between the adapter and the store. The key dependency is `@slack/bolt` 4.6.0 which bundles `@slack/socket-mode`, `@slack/web-api`, and `express` (the express dependency is a known concern for bundling in Phase 7 but is not a blocker for Phase 3).

**Primary recommendation:** Use `@slack/bolt` 4.6.0 with `socketMode: true` initialization. Build a Block Kit message builder module (`src/slack/blocks.ts`) that converts `EscalationRequest` types into Slack Block Kit JSON. Use `app.action()` listeners for button responses and `app.message()` listeners for thread replies. Map escalation IDs to Slack message timestamps (`ts`) in a local Map for response routing. Mark `@slack/bolt` as external in tsup config alongside `better-sqlite3`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SLCK-01 | Escalation messages use Slack Block Kit formatting with structured layout (title, context, question, options) | Block Kit verified: use `header` block for title, `section` blocks with `mrkdwn` for context and question, `actions` block with `button` elements for options. Official Slack Block Kit reference confirms up to 50 blocks per message. |
| SLCK-02 | Messages include interactive Approve/Deny/Snooze buttons for binary and multi-choice decisions | `actions` block with `button` elements using `action_id` for routing. Style `primary` for Approve (green), `danger` for Deny (red), default for Snooze. Bolt `app.action()` listener routes by `action_id`. Acknowledged within 3s via `ack()`. |
| SLCK-03 | Messages include rich GSD context -- current phase, task name, what Claude was about to do, and why it needs a decision | `context` block with `mrkdwn` elements displays metadata. `EscalationContext` type already has `eventType`, `toolName`, `filePaths`, `taskContext` fields. Map these to Block Kit `context` and `section` blocks. |
| SLCK-04 | MCP server maintains persistent Socket Mode WebSocket connection (no public URL required) | `@slack/bolt` 4.6.0 with `socketMode: true` uses `@slack/socket-mode` 2.x internally. Auto-reconnect is enabled by default. Connection lifecycle events (`connected`, `disconnected`, `reconnecting`) available for monitoring. |
| SLCK-05 | Follow-up context and status updates appear as threaded replies under the original escalation message | `client.chat.postMessage()` with `thread_ts` set to the parent message's `ts` value posts replies in the thread. Track `escalationId -> ts` mapping in adapter state. |
| SLCK-06 | User can respond with free-form text in thread and Claude receives it as context | `app.message()` listener receives all messages including thread replies. Filter by checking `message.thread_ts` matches a tracked escalation's `ts`. Extract `message.text` as the response and resolve the pending escalation. |
| PLAT-03 | Slack adapter implements full MessagingAdapter interface using @slack/bolt Socket Mode | `SlackAdapter` class implements `sendEscalation()`, `waitForResponse()`, `sendFollowUp()`, `isConnected()`. Uses Bolt App internally. `sendEscalation` calls `client.chat.postMessage()` with Block Kit blocks. `waitForResponse` uses a Promise/EventEmitter pattern resolved by action/message listeners. |
| CFG-03 | Startup validation on SessionStart -- verify Slack credentials, ping channel with "Escalate online" message, fail loudly if misconfigured | Call `client.auth.test()` to verify bot token validity. Call `client.chat.postMessage()` to the configured channel. If either fails, throw with clear error message including the specific failure reason. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@slack/bolt` | 4.6.0 | Slack app framework with Socket Mode, action/message listeners, Block Kit | Official Slack SDK; includes `@slack/socket-mode`, `@slack/web-api`, `@slack/types`; TypeScript types included; actively maintained; used in all Slack's official examples |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@slack/web-api` | 7.14.1+ | Direct Web API calls (`chat.postMessage`, `chat.update`, `auth.test`) | Bundled with `@slack/bolt`; used when calling Slack APIs directly via `app.client` |
| `@slack/socket-mode` | 2.0.5+ | Socket Mode WebSocket connection management | Bundled with `@slack/bolt`; handles connection lifecycle, auto-reconnect internally |
| `@slack/types` | 2.20.0+ | TypeScript types for Block Kit, messages, events | Bundled with `@slack/bolt`; use for type-safe block construction |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@slack/bolt` | `@slack/socket-mode` + `@slack/web-api` directly | Lower-level; requires manual action/message routing; no `ack()` convenience; more code for same result. Bolt is the recommended approach. |
| `@slack/bolt` | `slack-edge` (lighter HTTP-only SDK) | No Socket Mode support; requires public HTTP endpoint; not suitable for this use case. |
| Block Kit JSON objects | `jsx-slack` (JSX for Block Kit) | Adds a JSX transpilation dependency; overkill for the 3-4 message templates needed. Hand-written Block Kit JSON is simpler. |

**Installation:**
```bash
# Runtime dependency
pnpm add @slack/bolt

# No additional dev dependencies needed -- @slack/bolt includes TypeScript types
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── slack/
│   ├── adapter.ts          # SlackAdapter class implementing MessagingAdapter
│   ├── blocks.ts           # Block Kit message builder functions
│   ├── handlers.ts         # Action and message event handlers
│   └── types.ts            # Slack-specific internal types (ts mapping, etc.)
├── server/
│   ├── mcp-server.ts       # (existing) MCP tools
│   ├── http-bridge.ts      # (existing) HTTP bridge for hooks
│   └── index.ts            # (existing, updated) Wires Slack adapter into startup
├── state/                  # (existing) SQLite store
├── config/                 # (existing) Config loading
├── types/
│   ├── adapter.ts          # (existing) MessagingAdapter interface
│   └── escalation.ts       # (existing) EscalationRequest, UserResponse
└── index.ts                # (existing) Barrel exports
```

### Pattern 1: Slack Adapter as MessagingAdapter Implementation

**What:** A `SlackAdapter` class that implements the existing `MessagingAdapter` interface, wrapping `@slack/bolt` App internally. The adapter owns the Bolt App lifecycle (start/stop) and translates between platform-agnostic escalation types and Slack-specific Block Kit messages.

**When to use:** Always. This is the core pattern for the phase.

**Example:**
```typescript
// Source: Slack Bolt docs + existing MessagingAdapter interface
import { App } from '@slack/bolt';
import type { MessagingAdapter } from '../types/adapter.js';
import type { EscalationRequest, UserResponse } from '../types/escalation.js';

export class SlackAdapter implements MessagingAdapter {
  private app: App;
  private channelId: string;
  private connected = false;
  // Maps escalation ID -> Slack message ts for thread routing
  private escalationToTs = new Map<string, string>();
  // Maps Slack message ts -> escalation ID for reverse lookup
  private tsToEscalation = new Map<string, string>();
  // Pending response resolvers keyed by escalation ID
  private responseResolvers = new Map<string, (response: UserResponse) => void>();

  constructor(botToken: string, appToken: string, channelId: string) {
    this.channelId = channelId;
    this.app = new App({
      token: botToken,
      socketMode: true,
      appToken: appToken,
    });

    this.registerHandlers();
  }

  async start(): Promise<void> {
    await this.app.start();
    this.connected = true;
  }

  async sendEscalation(request: EscalationRequest): Promise<string> {
    const blocks = buildEscalationBlocks(request);
    const result = await this.app.client.chat.postMessage({
      channel: this.channelId,
      blocks,
      text: `${request.title}: ${request.question}`, // fallback for notifications
    });
    const ts = result.ts!;
    const escalationId = crypto.randomUUID();
    this.escalationToTs.set(escalationId, ts);
    this.tsToEscalation.set(ts, escalationId);
    return escalationId;
  }

  async waitForResponse(escalationId: string, timeoutMs: number): Promise<UserResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.responseResolvers.delete(escalationId);
        resolve({ type: 'timeout', respondedAt: new Date() });
      }, timeoutMs);

      this.responseResolvers.set(escalationId, (response) => {
        clearTimeout(timer);
        this.responseResolvers.delete(escalationId);
        resolve(response);
      });
    });
  }

  async sendFollowUp(escalationId: string, message: string): Promise<void> {
    const ts = this.escalationToTs.get(escalationId);
    if (!ts) return;
    await this.app.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: ts,
      text: message,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  private registerHandlers(): void {
    // Button actions
    this.app.action(/^escalate_/, async ({ body, ack, action }) => {
      await ack();
      // ... resolve escalation based on action_id
    });

    // Thread message replies
    this.app.message(async ({ message }) => {
      if ('thread_ts' in message && message.thread_ts) {
        const escalationId = this.tsToEscalation.get(message.thread_ts);
        if (escalationId) {
          // ... resolve escalation with text response
        }
      }
    });
  }
}
```

### Pattern 2: Block Kit Message Builder

**What:** Pure functions that convert `EscalationRequest` objects into Slack Block Kit JSON arrays. These functions are stateless and easily testable.

**When to use:** Every time an escalation message is sent.

**Example:**
```typescript
// Source: Slack Block Kit reference (docs.slack.dev/reference/block-kit/blocks/)
import type { EscalationRequest, SuggestedAction } from '../types/escalation.js';
import type { KnownBlock, Button } from '@slack/types';

export function buildEscalationBlocks(request: EscalationRequest): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header: title
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: request.title, emoji: true },
  });

  // Context: event metadata
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `*Event:* ${request.context.eventType}` },
      ...(request.context.toolName
        ? [{ type: 'mrkdwn' as const, text: `*Tool:* \`${request.context.toolName}\`` }]
        : []),
    ],
  });

  // Divider
  blocks.push({ type: 'divider' });

  // Question
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: request.question },
  });

  // Task context (if available)
  if (request.context.taskContext) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `> ${request.context.taskContext}` },
    });
  }

  // File paths (if available)
  if (request.context.filePaths && request.context.filePaths.length > 0) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `*Files:* ${request.context.filePaths.join(', ')}` },
      ],
    });
  }

  // Action buttons
  if (request.suggestedActions.length > 0) {
    blocks.push({
      type: 'actions',
      elements: request.suggestedActions.map((action): Button => ({
        type: 'button',
        text: { type: 'plain_text', text: action.label, emoji: true },
        action_id: `escalate_${action.id}`,
        value: action.id,
        ...(action.style === 'primary' ? { style: 'primary' } : {}),
        ...(action.style === 'danger' ? { style: 'danger' } : {}),
      })),
    });
  }

  return blocks;
}
```

### Pattern 3: Escalation ID to Slack ts Mapping

**What:** A bidirectional in-memory map between platform-agnostic escalation IDs and Slack-specific message timestamps (`ts`). The `ts` is Slack's unique identifier for a message and is needed to post threaded replies and update messages.

**When to use:** Always. Every escalation sent to Slack creates a mapping entry.

**Key insight:** Slack message `ts` values are strings like `"1476746830.000003"`. They serve as both the message ID and the thread parent ID. When a button is clicked, the action payload includes `body.message.ts` and `body.channel.id`. When a thread reply arrives, `message.thread_ts` points to the parent.

**Example:**
```typescript
// In SlackAdapter
private escalationToTs = new Map<string, string>();  // escalation ID -> Slack ts
private tsToEscalation = new Map<string, string>();   // Slack ts -> escalation ID

// On send
const result = await client.chat.postMessage({ channel, blocks, text });
this.escalationToTs.set(escalationId, result.ts!);
this.tsToEscalation.set(result.ts!, escalationId);

// On action (button click)
app.action(/^escalate_/, async ({ body, ack }) => {
  await ack();
  const ts = body.message?.ts;
  if (ts) {
    const escalationId = this.tsToEscalation.get(ts);
    // ... resolve with action response
  }
});

// On thread reply
app.message(async ({ message }) => {
  if (message.thread_ts) {
    const escalationId = this.tsToEscalation.get(message.thread_ts);
    // ... resolve with text response
  }
});
```

### Pattern 4: Message Update After Button Click

**What:** After a user clicks an action button, update the original message to show the decision was recorded (replace buttons with a confirmation). This prevents duplicate clicks and gives visual feedback.

**When to use:** After every button action is processed.

**Example:**
```typescript
// Source: Slack chat.update docs (docs.slack.dev/reference/methods/chat.update/)
app.action(/^escalate_/, async ({ body, ack, client }) => {
  await ack();

  const actionId = (body as any).actions?.[0]?.action_id;
  const ts = body.message?.ts;
  const channelId = body.channel?.id;

  if (ts && channelId) {
    // Update the message to show the decision
    await client.chat.update({
      channel: channelId,
      ts: ts,
      blocks: [
        // Keep original header/context blocks...
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:white_check_mark: *Decision recorded:* ${actionId}`,
          },
        },
      ],
      text: `Decision recorded: ${actionId}`,
    });
  }
});
```

### Pattern 5: Startup Validation (CFG-03)

**What:** On server startup, validate Slack credentials and post a test message before accepting escalations.

**When to use:** During MCP server initialization, before the Bolt App is considered ready.

**Example:**
```typescript
// Source: Slack auth.test docs (docs.slack.dev/reference/methods/auth.test/)
async function validateSlackConnection(
  app: App,
  channelId: string,
): Promise<void> {
  // 1. Verify credentials
  const authResult = await app.client.auth.test();
  if (!authResult.ok) {
    throw new Error(`Slack auth failed: ${authResult.error}`);
  }

  // 2. Post "Escalate online" to configured channel
  const postResult = await app.client.chat.postMessage({
    channel: channelId,
    text: ':zap: Escalate online -- ready to receive escalations',
  });
  if (!postResult.ok) {
    throw new Error(`Failed to post to channel ${channelId}: ${postResult.error}`);
  }
}
```

### Anti-Patterns to Avoid

- **Creating Bolt App per escalation:** The Bolt App owns a persistent WebSocket connection. Creating and destroying it per message is slow and misses incoming events. Create once, use for the session lifetime.

- **Blocking on `waitForResponse` with synchronous poll:** The `waitForResponse` method should use Promise-based resolution (event-driven), not polling. The Bolt action/message handlers resolve the Promise when a response arrives.

- **Storing Slack `ts` in SQLite:** The `ts -> escalation ID` mapping is ephemeral (per-session). It belongs in memory, not the database. The database stores platform-agnostic escalation records.

- **Using `say()` for thread replies:** The `say()` function in action handlers posts to the conversation where the action occurred, but not necessarily in the correct thread. Use `client.chat.postMessage()` with explicit `thread_ts` for thread replies.

- **Ignoring `ack()` timing:** Slack requires action acknowledgment within 3 seconds. Always call `await ack()` immediately in action handlers, before any slow operations (database writes, external calls).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket connection to Slack | Custom WebSocket client | `@slack/bolt` with `socketMode: true` | Handles connection negotiation, token refresh, auto-reconnect, ping/pong, message framing, envelope acknowledgment |
| Action routing | Custom event parser for interactive payloads | `app.action()` listener with `action_id` matching | Handles payload parsing, type narrowing, `ack()` requirement, error handling |
| Block Kit JSON construction | String interpolation or manual JSON | Typed Block Kit objects from `@slack/types` | TypeScript types catch invalid block structures at compile time |
| Thread routing | Manual message lookup via `conversations.replies` | `message.thread_ts` from incoming events | Already provided by Bolt in message event payloads |
| Credential validation | Manual HTTP requests to Slack API | `client.auth.test()` from `@slack/web-api` | Handles token formats, error codes, rate limiting |
| Message acknowledgment | Manual HTTP 200 response to Slack | `ack()` function in Bolt handlers | Bolt handles the response_url, timing, and retry logic |

**Key insight:** `@slack/bolt` handles all the Slack platform complexity (WebSocket lifecycle, payload parsing, type safety, `ack()` timing). The adapter's job is translation: `EscalationRequest` to Block Kit, Slack events to `UserResponse`.

## Common Pitfalls

### Pitfall 1: `ack()` Not Called Within 3 Seconds

**What goes wrong:** Slack retries the action payload because it never received acknowledgment. The action handler runs multiple times, potentially resolving the same escalation twice.
**Why it happens:** Slow database operations or external API calls before `ack()`.
**How to avoid:** Always call `await ack()` as the FIRST line in every action handler. Do all slow work (database writes, message updates) after acknowledging.
**Warning signs:** Duplicate escalation resolutions; Slack showing "This action failed" to the user.

### Pitfall 2: Express Dependency in Bundle (Phase 7 concern)

**What goes wrong:** `@slack/bolt` 4.6.0 depends on `express@^5.0.0` as a direct dependency, even when using Socket Mode (where express is not needed). This inflates the bundle and may cause bundling issues with tsup.
**Why it happens:** Bolt's default `HTTPReceiver` uses express internally. The dependency is declared unconditionally even though `SocketModeReceiver` does not use it.
**How to avoid:** Mark `@slack/bolt` as `external` in `tsup.config.ts` (same pattern as `better-sqlite3`). For Phase 3, this is fine -- the full `node_modules` are available during development. Phase 7 will address distribution packaging.
**Warning signs:** Large bundle size; bundler warnings about express internals.

### Pitfall 3: Socket Mode Disconnection During Long Operations

**What goes wrong:** The WebSocket connection drops (expected behavior -- connections refresh every few hours). Pending escalations that were sent before the disconnect have their action/message handlers unregistered.
**Why it happens:** Slack Socket Mode connections are not permanent. They disconnect and reconnect periodically.
**How to avoid:** `@slack/bolt` handles auto-reconnect internally. The action/message handlers are re-registered on reconnect because they are registered on the `App` instance, not the individual connection. The `escalationToTs` map persists in memory across reconnects. For extra safety, listen to `connected`/`disconnected` events and log them.
**Warning signs:** Gaps in message delivery; escalations showing as timed out despite user responding.

### Pitfall 4: Thread Reply From Bot Triggering Own Handler

**What goes wrong:** When the adapter posts a follow-up message in a thread, the `app.message()` handler fires for the bot's own message, potentially resolving the escalation with the bot's own text.
**Why it happens:** By default, Bolt receives all message events, including the bot's own messages.
**How to avoid:** Use the `ignoreSelf` option (enabled by default in Bolt). Additionally, check `message.bot_id` or `message.subtype === 'bot_message'` in the message handler to filter out bot messages.
**Warning signs:** Escalations resolving immediately after a follow-up is sent; circular message loops.

### Pitfall 5: Race Between Button Click and Thread Reply

**What goes wrong:** A user clicks a button AND types a thread reply. Both handlers fire and try to resolve the same escalation.
**Why it happens:** Multiple response paths are active simultaneously.
**How to avoid:** Use the `EscalationStore.resolve()` method which has a `WHERE status = 'pending'` guard. The first resolution succeeds (returns `changes > 0`); the second fails silently (returns `changes === 0`). After resolving, remove the escalation from the in-memory maps. Check the resolve result before posting confirmation.
**Warning signs:** Duplicate resolution attempts; inconsistent confirmation messages.

### Pitfall 6: Slack Channel ID vs Channel Name

**What goes wrong:** Config has a channel name (e.g., `#escalations`) but the API expects a channel ID (e.g., `C01234ABCDE`).
**Why it happens:** Users naturally think in channel names, but `chat.postMessage` requires channel IDs for reliability.
**How to avoid:** Document that `channelId` in config must be the Slack channel ID, not the name. Channel IDs can be found in Slack by right-clicking a channel and copying the link. Alternatively, add a `conversations.list` lookup on startup (but this adds complexity and requires extra scopes).
**Warning signs:** "channel_not_found" errors on first message send.

### Pitfall 7: Missing Bot Scopes

**What goes wrong:** `chat.postMessage` or `auth.test` fails with `missing_scope` error.
**Why it happens:** The Slack app was created without all required bot token scopes.
**How to avoid:** Document required scopes clearly. Minimum required: `chat:write` (post messages), `channels:history` or `groups:history` (receive message events for thread replies). App token requires `connections:write` (Socket Mode).
**Warning signs:** Slack API returning `missing_scope` errors at startup or on first escalation send.

### Pitfall 8: stdout Pollution From Bolt Logger

**What goes wrong:** Bolt's internal logger writes to stdout by default, corrupting the MCP stdio protocol.
**Why it happens:** `@slack/bolt` uses a logger that may default to stdout output.
**How to avoid:** Configure Bolt's logger to use stderr: pass a custom `logger` option that writes to `console.error`, or use `logLevel: LogLevel.ERROR` to minimize output. This is critical because the MCP server shares the same process.
**Warning signs:** MCP server disconnects after Bolt initialization; JSON parse errors in Claude Code debug output.

## Code Examples

Verified patterns from official sources:

### Initialize Bolt App with Socket Mode

```typescript
// Source: Slack Bolt docs (docs.slack.dev/tools/bolt-js/concepts/socket-mode/)
import { App, LogLevel } from '@slack/bolt';

const app = new App({
  token: process.env['ESCALATE_SLACK_BOT_TOKEN'],
  socketMode: true,
  appToken: process.env['ESCALATE_SLACK_APP_TOKEN'],
  logLevel: LogLevel.ERROR, // CRITICAL: prevent stdout pollution
});

await app.start();
console.error('[escalate] Slack Socket Mode connected');
```

### Send Block Kit Message with Buttons

```typescript
// Source: Slack Block Kit reference + Bolt message sending docs
const result = await app.client.chat.postMessage({
  channel: channelId,
  blocks: [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Permission Required', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Claude wants to run `rm -rf ./dist` via Bash tool',
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '*Event:* PreToolUse | *Tool:* Bash' },
      ],
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve', emoji: true },
          style: 'primary',
          action_id: 'escalate_approve',
          value: 'approve',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Deny', emoji: true },
          style: 'danger',
          action_id: 'escalate_deny',
          value: 'deny',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Snooze', emoji: true },
          action_id: 'escalate_snooze',
          value: 'snooze',
        },
      ],
    },
  ],
  text: 'Permission Required: Claude wants to run rm -rf ./dist',
});
```

### Listen for Button Actions

```typescript
// Source: Slack Bolt actions docs (docs.slack.dev/tools/bolt-js/concepts/actions/)
app.action(/^escalate_/, async ({ body, ack, client, action }) => {
  // CRITICAL: Acknowledge within 3 seconds
  await ack();

  const actionId = (action as any).action_id as string;
  const ts = body.message?.ts;
  const channelId = body.channel?.id;

  if (!ts || !channelId) return;

  const escalationId = tsToEscalation.get(ts);
  if (!escalationId) return;

  // Resolve the escalation
  const response: UserResponse = {
    type: 'action',
    actionId: actionId.replace('escalate_', ''),
    respondedAt: new Date(),
  };

  // Resolve pending Promise (for waitForResponse)
  const resolver = responseResolvers.get(escalationId);
  if (resolver) {
    resolver(response);
  }

  // Update the original message to show decision
  await client.chat.update({
    channel: channelId,
    ts: ts,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark: *${actionId.replace('escalate_', '')}* by <@${body.user.id}>`,
        },
      },
    ],
    text: `Decision: ${actionId.replace('escalate_', '')}`,
  });
});
```

### Listen for Thread Replies

```typescript
// Source: Slack Bolt message listening docs + GitHub issues on thread handling
app.message(async ({ message }) => {
  // Only process thread replies (messages with thread_ts)
  if (!('thread_ts' in message) || !message.thread_ts) return;

  // Ignore bot's own messages (ignoreSelf should handle this, but be explicit)
  if ('bot_id' in message && message.bot_id) return;
  if ('subtype' in message && message.subtype === 'bot_message') return;

  const escalationId = tsToEscalation.get(message.thread_ts);
  if (!escalationId) return; // Not a tracked escalation thread

  const response: UserResponse = {
    type: 'text',
    text: 'text' in message ? (message.text ?? '') : '',
    respondedAt: new Date(),
  };

  const resolver = responseResolvers.get(escalationId);
  if (resolver) {
    resolver(response);
  }
});
```

### Validate Credentials on Startup

```typescript
// Source: Slack auth.test docs (docs.slack.dev/reference/methods/auth.test/)
async function validateAndAnnounce(app: App, channelId: string): Promise<void> {
  // Step 1: Verify bot token
  const auth = await app.client.auth.test();
  if (!auth.ok) {
    throw new Error(
      `Slack authentication failed. Check ESCALATE_SLACK_BOT_TOKEN. Error: ${auth.error}`,
    );
  }
  console.error(`[escalate] Authenticated as ${auth.user} in workspace ${auth.team}`);

  // Step 2: Post "Escalate online" to channel
  const post = await app.client.chat.postMessage({
    channel: channelId,
    text: ':zap: Escalate online -- ready to receive escalations',
  });
  if (!post.ok) {
    throw new Error(
      `Failed to post to channel ${channelId}. Check channel ID and bot permissions. Error: ${post.error}`,
    );
  }
  console.error(`[escalate] Posted startup message to channel ${channelId}`);
}
```

### Post Threaded Follow-Up

```typescript
// Source: Slack chat.postMessage with thread_ts
async function sendFollowUp(
  client: WebClient,
  channelId: string,
  parentTs: string,
  message: string,
): Promise<void> {
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: parentTs, // MUST be a string, not a number
    text: message,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTTP Events API (requires public URL) | Socket Mode (WebSocket, no public URL) | Bolt 3.0.0 (2021) | No ngrok/tunnel needed for development or deployment; simpler infrastructure |
| `ExpressReceiver` as default | `HTTPReceiver` as default (Bolt 4.x) | Bolt 4.0.0 (2024) | Express is still a dependency but is no longer the default receiver; `SocketModeReceiver` is separate |
| `@slack/bolt@3.x` | `@slack/bolt@4.6.0` | Jan 2024 | Express 5 support, TypeScript improvements, AI streaming features, no breaking changes for Socket Mode usage |
| `@slack/interactive-messages` (deprecated) | `app.action()` in Bolt | Bolt 2.x (2020) | Old package deprecated; all interactive handling through Bolt now |
| `RTM API` (Real Time Messaging) | Socket Mode | 2020 | RTM deprecated for new apps; Socket Mode is the replacement for real-time event delivery |

**Deprecated/outdated:**
- `@slack/rtm-api`: Deprecated. Use Socket Mode via `@slack/bolt` instead.
- `@slack/interactive-messages`: Deprecated. Use `app.action()` in Bolt.
- `@slack/events-api`: Deprecated. Use `app.event()` in Bolt.
- Block Kit "legacy attachments": Use Block Kit `blocks` array instead of `attachments` for message formatting.

## Testing Strategy

### Unit Testing (No Slack Connection)

The Block Kit message builder (`blocks.ts`) is pure functions -- test with standard vitest assertions against expected JSON output.

The adapter logic (ID mapping, response routing, Promise resolution) can be tested by mocking the Bolt `App` instance. Create mock `action` and `message` event payloads and verify the adapter correctly resolves pending escalations.

### Integration Testing Considerations

Full integration tests require a real Slack workspace, which is impractical for CI. Instead:

1. **Mock the Slack WebClient:** Replace `app.client.chat.postMessage` etc. with vitest mocks that return fake `ts` values
2. **Simulate action payloads:** Call action handler functions directly with mock payloads containing `body.message.ts`, `body.channel.id`, `body.actions[0].action_id`
3. **Simulate message events:** Call message handler functions with mock payloads containing `thread_ts` and `text`

### Manual Testing Checklist

- Create a test Slack workspace and app (free tier works)
- Generate bot token with `chat:write`, `channels:history` scopes
- Generate app token with `connections:write` scope
- Verify "Escalate online" message appears on startup
- Send a test escalation and verify Block Kit formatting
- Tap Approve/Deny buttons and verify SQLite state changes
- Type a thread reply and verify escalation resolution
- Disconnect WiFi briefly and verify auto-reconnect

## Slack App Setup Requirements

For reference during implementation, the Slack app needs:

**Bot Token Scopes (xoxb-):**
- `chat:write` -- Post messages and send replies
- `channels:history` -- Read message events (needed for thread reply detection)

**App-Level Token Scopes (xapp-):**
- `connections:write` -- Establish Socket Mode WebSocket connections

**Event Subscriptions (via Socket Mode):**
- `message.channels` -- Receive messages posted to channels (for thread reply detection)

**Interactivity:**
- Enabled automatically when using Socket Mode

## Open Questions

1. **Integration with `startServer()` lifecycle**
   - What we know: The existing `startServer()` in `src/server/index.ts` creates the store, MCP server, and HTTP bridge. The Slack adapter needs to start alongside them.
   - What's unclear: Whether the Slack adapter should start before or after the MCP server connects to stdio. If Slack connection is slow, it could delay MCP tool availability.
   - Recommendation: Start the Bolt App asynchronously. Don't block MCP server startup on Slack connection. The adapter's `isConnected()` method lets MCP tools check availability before sending. Log warnings if Slack is not connected when an escalation is requested.

2. **Config schema update for Slack channel validation**
   - What we know: `SlackConfigSchema` in `src/config/schema.ts` currently only has `channelId: z.string().min(1)`.
   - What's unclear: Whether we should validate the channel ID format (starts with `C` or `G`) or just let Slack API errors surface naturally.
   - Recommendation: Keep validation simple (non-empty string). Let the startup validation ping catch invalid channel IDs. Over-validating the format risks rejecting valid IDs from future Slack formats.

3. **Handling `waitForResponse` when adapter is used outside the adapter pattern**
   - What we know: The current MCP server resolves escalations via `store.resolve()` called from the HTTP bridge (by hook scripts). The Slack adapter adds another resolution path (button clicks and thread replies).
   - What's unclear: Whether both resolution paths (HTTP bridge + Slack) should coexist, or whether Phase 3 should route all resolutions through the adapter.
   - Recommendation: Both paths should coexist. The HTTP bridge is used by hook scripts to poll for resolution. The Slack adapter writes to the same store via `store.resolve()`. The hook script polling will pick up the resolution regardless of source. The adapter does NOT need to use `waitForResponse` for the hook-driven flow -- that method is for future direct MCP tool usage.

4. **Memory cleanup for escalation-to-ts maps**
   - What we know: In-memory maps grow as escalations accumulate during a session.
   - What's unclear: How many escalations a typical session generates and whether cleanup is needed.
   - Recommendation: Clean up map entries when an escalation is resolved or timed out. Add a TTL-based cleanup (e.g., remove entries older than the maximum timeout + buffer). This prevents unbounded memory growth in long sessions.

## Sources

### Primary (HIGH confidence)
- Slack Bolt for JS official docs (docs.slack.dev/tools/bolt-js/) -- Socket Mode setup, action listeners, message listeners, configuration reference
- Slack Block Kit reference (docs.slack.dev/reference/block-kit/blocks/) -- Block types, button styles, actions block structure
- Slack Web API reference (docs.slack.dev/reference/methods/) -- chat.postMessage, chat.update, auth.test parameters
- `@slack/bolt` npm package (npmjs.com/package/@slack/bolt) -- version 4.6.0, dependencies, Node >=18
- `@slack/bolt` GitHub releases (github.com/slackapi/bolt-js/releases) -- v4.6.0 latest, no breaking changes in 4.x
- `@slack/socket-mode` npm README (github.com/slackapi/node-slack-sdk) -- SocketModeClient lifecycle events, auto-reconnect
- Existing codebase: `src/types/adapter.ts` (MessagingAdapter interface), `src/types/escalation.ts` (EscalationRequest, UserResponse), `src/state/store.ts` (EscalationStore API), `src/server/index.ts` (server startup lifecycle)

### Secondary (MEDIUM confidence)
- Slack GitHub issues on reconnection (github.com/slackapi/bolt-js/issues/1906) -- Socket Mode reconnection is by design; multiple connections recommended for critical uptime
- Slack GitHub issues on threading (github.com/slackapi/bolt-js/issues/1370, #2172) -- thread_ts handling patterns, message subtype filtering
- Slack GitHub issues on action payloads (github.com/slackapi/bolt-js/issues/1799) -- body.message.ts and body.channel.id access patterns

### Tertiary (LOW confidence)
- `@slack-wrench/jest-bolt-receiver` (npmjs.com/package/@slack-wrench/jest-bolt-receiver) -- testing utility exists but may not be compatible with vitest; needs validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- `@slack/bolt` 4.6.0 is the official, actively maintained Slack app framework; version verified on npm; Socket Mode support confirmed in official docs
- Architecture: HIGH -- adapter pattern matches existing `MessagingAdapter` interface; Block Kit JSON structure verified in official reference; action/message handler patterns verified in official Bolt docs
- Pitfalls: HIGH -- ack() timing requirement documented in official docs; stdout pollution is a known concern from Phase 2 research; reconnection behavior documented in Slack's official Socket Mode docs and GitHub issues

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (30 days -- stable domain; @slack/bolt 4.x is mature)
