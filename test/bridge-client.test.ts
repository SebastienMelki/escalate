/**
 * Unit tests for the shared bridge client library.
 *
 * Tests port reading (filesystem), escalation creation (fetch mock),
 * and response polling (fetch mock with multiple calls).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPort, createEscalation, pollForResponse, POLL_INTERVAL_MS } from '../scripts/lib/bridge-client.js';

describe('bridge-client', () => {
  describe('readPort', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `escalate-test-${Date.now()}`);
      mkdirSync(join(tempDir, '.claude'), { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    });

    it('reads port from the port file and returns a number', () => {
      writeFileSync(join(tempDir, '.claude', 'escalate-port'), '3456', 'utf-8');
      vi.stubEnv('CLAUDE_PROJECT_DIR', tempDir);

      const port = readPort();
      expect(port).toBe(3456);
    });

    it('throws on missing port file', () => {
      vi.stubEnv('CLAUDE_PROJECT_DIR', tempDir);
      rmSync(join(tempDir, '.claude', 'escalate-port'), { force: true });

      expect(() => readPort()).toThrow();
    });

    it('throws on non-numeric content', () => {
      writeFileSync(join(tempDir, '.claude', 'escalate-port'), 'not-a-number', 'utf-8');
      vi.stubEnv('CLAUDE_PROJECT_DIR', tempDir);

      expect(() => readPort()).toThrow(/Invalid port value/);
    });
  });

  describe('createEscalation', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('POSTs correct JSON and returns parsed response', async () => {
      const mockResponse = { escalation_id: 'abc-123', status: 'pending' };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve(mockResponse),
        }),
      );

      const result = await createEscalation(9999, {
        event_type: 'PermissionRequest',
        request_json: '{"tool_name":"Bash"}',
        fallback_action: 'deny',
        timeout_seconds: 600,
      });

      expect(result).toEqual(mockResponse);

      // Verify fetch was called with correct URL and body
      const fetchMock = vi.mocked(globalThis.fetch);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://127.0.0.1:9999/escalations');
      expect((options as RequestInit).method).toBe('POST');

      const sentBody = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
      expect(sentBody).toEqual({
        event_type: 'PermissionRequest',
        request_json: '{"tool_name":"Bash"}',
        fallback_action: 'deny',
        timeout_seconds: 600,
      });
    });
  });

  describe('pollForResponse', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns immediately when status is resolved', async () => {
      const resolvedRecord = {
        id: 'esc-1',
        status: 'resolved',
        responseJson: '{"type":"action","actionId":"approve"}',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve(resolvedRecord),
        }),
      );

      const result = await pollForResponse(9999, 'esc-1', 5000);

      expect(result.status).toBe('resolved');
      expect(result.responseJson).toBe('{"type":"action","actionId":"approve"}');

      // Should only have fetched once (no polling needed)
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
    });

    it('polls multiple times when pending then resolved', async () => {
      const pendingRecord = { id: 'esc-2', status: 'pending' };
      const resolvedRecord = {
        id: 'esc-2',
        status: 'resolved',
        responseJson: '{"type":"text","text":"yes"}',
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ json: () => Promise.resolve(pendingRecord) })
        .mockResolvedValueOnce({ json: () => Promise.resolve(resolvedRecord) });

      vi.stubGlobal('fetch', fetchMock);

      const result = await pollForResponse(9999, 'esc-2', 30_000);

      expect(result.status).toBe('resolved');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns timed_out when deadline expires', async () => {
      const pendingRecord = { id: 'esc-3', status: 'pending' };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve(pendingRecord),
        }),
      );

      // Use a very short timeout to trigger deadline
      const result = await pollForResponse(9999, 'esc-3', 100);

      expect(result.status).toBe('timed_out');
    });
  });

  describe('constants', () => {
    it('POLL_INTERVAL_MS is 2000', () => {
      expect(POLL_INTERVAL_MS).toBe(2000);
    });
  });
});
