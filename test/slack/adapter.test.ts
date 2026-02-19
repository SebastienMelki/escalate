/**
 * Unit tests for SlackAdapter.
 *
 * Mocks @slack/bolt's App class to avoid real Slack WebSocket connections.
 * Tests verify the adapter's public API: message posting, thread routing,
 * timeout behavior, and credential validation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { EscalationStore } from '../../src/state/store.js';
import type { EscalationRequest } from '../../src/types/escalation.js';
import type { EscalateConfig } from '../../src/config/schema.js';

// --- Mock @slack/bolt ---

/** Captured handler registrations from the mock App. */
let registeredActionHandlers: Array<{ pattern: RegExp; handler: (...args: unknown[]) => unknown }> =
  [];
let registeredMessageHandlers: Array<(...args: unknown[]) => unknown> = [];
let registeredEventHandlers: Array<{ event: string; handler: (...args: unknown[]) => unknown }> =
  [];

const mockPostMessage = vi.fn().mockResolvedValue({ ok: true, ts: 'mock.ts.1234' });
const mockChatUpdate = vi.fn().mockResolvedValue({ ok: true });
const mockAuthTest = vi.fn().mockResolvedValue({ ok: true, user: 'testbot', team: 'testteam' });
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);

vi.mock('@slack/bolt', () => {
  class MockApp {
    client = {
      auth: { test: mockAuthTest },
      chat: {
        postMessage: mockPostMessage,
        update: mockChatUpdate,
      },
    };

    action(pattern: RegExp, handler: (...args: unknown[]) => unknown): void {
      registeredActionHandlers.push({ pattern, handler });
    }

    message(handler: (...args: unknown[]) => unknown): void {
      registeredMessageHandlers.push(handler);
    }

    event(eventName: string, handler: (...args: unknown[]) => unknown): void {
      registeredEventHandlers.push({ event: eventName, handler });
    }

    start = mockStart;
    stop = mockStop;
  }

  return {
    App: MockApp,
    LogLevel: { ERROR: 'error' },
  };
});

// Import AFTER mock is set up
const { SlackAdapter } = await import('../../src/slack/adapter.js');

/** Helper: creates a test EscalationRequest. */
function makeRequest(overrides?: Partial<EscalationRequest>): EscalationRequest {
  return {
    title: 'Test Escalation',
    question: 'Should I proceed?',
    urgency: 'warning',
    context: { eventType: 'permissionRequest', toolName: 'Bash' },
    suggestedActions: [
      { id: 'allow', label: 'Allow', style: 'primary' },
      { id: 'deny', label: 'Deny', style: 'danger' },
    ],
    allowFreeformResponse: true,
    ...overrides,
  };
}

describe('SlackAdapter', () => {
  let store: EscalationStore;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    store = new EscalationStore(db);

    // Reset handler registrations
    registeredActionHandlers = [];
    registeredMessageHandlers = [];
    registeredEventHandlers = [];

    // Reset mocks
    vi.clearAllMocks();
    mockPostMessage.mockResolvedValue({ ok: true, ts: 'mock.ts.1234' });
    mockAuthTest.mockResolvedValue({ ok: true, user: 'testbot', team: 'testteam' });
  });

  /** Minimal config with multimodal defaults for testing. */
  const defaultConfig: EscalateConfig = {
    slack: { channelId: 'C12345' },
    timeouts: { permissionRequest: 600000, preToolUse: 300000, stop: 600000, postToolUseFailure: 60000 },
    escalationPolicies: { permissionRequest: 'always', preToolUse: 'conditional', stop: 'always', postToolUseFailure: 'always' },
    fallbackActions: { permissionRequest: 'deny', preToolUse: 'deny', stop: 'ask-again', postToolUseFailure: 'allow' },
    autoApprovalRules: [],
    quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC', criticalEvents: ['PermissionRequest', 'Stop'] },
    multimodal: {
      emojiReactions: {
        enabled: true,
        mapping: { white_check_mark: 'approve', x: 'deny' },
      },
      voiceNotes: { enabled: false, provider: 'whisper', maxDurationSeconds: 120, maxFileSizeMb: 10 },
    },
    auditLog: { enabled: true },
  };

  function createAdapter(configOverrides?: Partial<EscalateConfig>): InstanceType<typeof SlackAdapter> {
    return new SlackAdapter({
      botToken: 'xoxb-test-token',
      appToken: 'xapp-test-token',
      channelId: 'C12345',
      store,
      config: { ...defaultConfig, ...configOverrides },
    });
  }

  describe('constructor', () => {
    it('registers action and message handlers on construction', () => {
      createAdapter();

      expect(registeredActionHandlers.length).toBeGreaterThanOrEqual(1);
      expect(registeredMessageHandlers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('sendEscalation', () => {
    it('posts message and returns escalation ID', async () => {
      const adapter = createAdapter();
      const request = makeRequest();

      const escalationId = await adapter.sendEscalation(request);

      // Returns a valid UUID
      expect(escalationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // Called chat.postMessage with channel and blocks
      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          blocks: expect.arrayContaining([]) as unknown,
          text: expect.any(String) as unknown,
        }),
      );
    });

    it('stores bidirectional ts mapping for follow-ups', async () => {
      const adapter = createAdapter();
      const request = makeRequest();

      const escalationId = await adapter.sendEscalation(request);

      // After sendEscalation, sendFollowUp should be able to route to the thread
      await adapter.sendFollowUp(escalationId, 'Follow-up message');

      // Second call is the follow-up (first was sendEscalation)
      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      expect(mockPostMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          thread_ts: 'mock.ts.1234',
          text: 'Follow-up message',
        }),
      );
    });
  });

  describe('sendFollowUp', () => {
    it('posts threaded reply for known escalation', async () => {
      const adapter = createAdapter();
      const escalationId = await adapter.sendEscalation(makeRequest());

      await adapter.sendFollowUp(escalationId, 'Thread reply');

      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      expect(mockPostMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ thread_ts: 'mock.ts.1234' }),
      );
    });

    it('silently ignores unknown escalation ID', async () => {
      const adapter = createAdapter();

      // Should not throw
      await expect(adapter.sendFollowUp('unknown-id', 'test')).resolves.toBeUndefined();

      // No API call made (no sendEscalation call either)
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  describe('waitForResponse', () => {
    it('resolves on timeout', async () => {
      const adapter = createAdapter();
      await adapter.sendEscalation(makeRequest());

      const start = Date.now();
      const response = await adapter.waitForResponse('some-id', 50);
      const elapsed = Date.now() - start;

      expect(response.type).toBe('timeout');
      expect(response.respondedAt).toBeInstanceOf(Date);
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some timing tolerance
    });
  });

  describe('isConnected', () => {
    it('returns false before start', () => {
      const adapter = createAdapter();
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after start', async () => {
      const adapter = createAdapter();
      await adapter.start();
      expect(adapter.isConnected()).toBe(true);
    });

    it('returns false after stop', async () => {
      const adapter = createAdapter();
      await adapter.start();
      await adapter.stop();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('validateAndAnnounce', () => {
    it('throws on auth failure', async () => {
      mockAuthTest.mockResolvedValue({ ok: false, error: 'invalid_auth' });

      const adapter = createAdapter();

      await expect(adapter.validateAndAnnounce()).rejects.toThrow(
        'Slack authentication failed. Check ESCALATE_SLACK_BOT_TOKEN',
      );
    });

    it('posts startup message on success', async () => {
      const adapter = createAdapter();

      await adapter.validateAndAnnounce();

      // auth.test was called
      expect(mockAuthTest).toHaveBeenCalledOnce();

      // Startup message posted
      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          text: expect.stringContaining('Escalate online') as unknown,
        }),
      );
    });

    it('throws when channel post fails', async () => {
      mockPostMessage.mockResolvedValue({ ok: false, error: 'channel_not_found' });

      const adapter = createAdapter();

      await expect(adapter.validateAndAnnounce()).rejects.toThrow(
        'Failed to post to channel C12345',
      );
    });
  });

  describe('start and stop', () => {
    it('calls app.start() on start', async () => {
      const adapter = createAdapter();
      await adapter.start();
      expect(mockStart).toHaveBeenCalledOnce();
    });

    it('calls app.stop() on stop', async () => {
      const adapter = createAdapter();
      await adapter.start();
      await adapter.stop();
      expect(mockStop).toHaveBeenCalledOnce();
    });
  });
});
