/**
 * Integration tests for the HTTP bridge server.
 *
 * Uses in-memory SQLite for test isolation and Node.js built-in fetch()
 * for HTTP requests (available in Node 22+).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { EscalationStore } from '../../src/state/store.js';
import { createHttpBridge } from '../../src/server/http-bridge.js';

describe('HTTP Bridge', () => {
  let db: Database.Database;
  let store: EscalationStore;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    db = new Database(':memory:');
    store = new EscalationStore(db);
    server = createHttpBridge(store);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${String(addr.port)}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    db.close();
  });

  it('GET /health returns 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body).toEqual({ status: 'ok' });
  });

  it('POST /escalations with valid body returns 201 with escalation_id and status', async () => {
    const res = await fetch(`${baseUrl}/escalations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'PermissionRequest',
        request_json: JSON.stringify({ title: 'Test', question: 'Allow?' }),
        fallback_action: 'deny',
        timeout_seconds: 600,
      }),
    });

    expect(res.status).toBe(201);

    const body = (await res.json()) as { escalation_id: string; status: string };
    expect(body.escalation_id).toBeDefined();
    expect(body.status).toBe('pending');
  });

  it('POST /escalations with invalid JSON returns 400', async () => {
    const res = await fetch(`${baseUrl}/escalations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    });

    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it('GET /escalations/:id for existing escalation returns 200 with the record', async () => {
    // Create an escalation first
    const createRes = await fetch(`${baseUrl}/escalations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'PreToolUse',
        request_json: JSON.stringify({ title: 'Tool Check', question: 'Allow tool?' }),
      }),
    });
    const created = (await createRes.json()) as { escalation_id: string };

    // Get the escalation
    const res = await fetch(`${baseUrl}/escalations/${created.escalation_id}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; status: string; eventType: string };
    expect(body.id).toBe(created.escalation_id);
    expect(body.status).toBe('pending');
    expect(body.eventType).toBe('PreToolUse');
  });

  it('GET /escalations/:id for non-existent ID returns 404', async () => {
    const res = await fetch(`${baseUrl}/escalations/nonexistent-id-12345`);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not found');
  });

  it('GET /escalations/:id after resolving returns status resolved', async () => {
    // Create an escalation
    const createRes = await fetch(`${baseUrl}/escalations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'PermissionRequest',
        request_json: JSON.stringify({ title: 'Resolve Test', question: 'Allow?' }),
        fallback_action: 'allow',
        timeout_seconds: 600,
      }),
    });
    const created = (await createRes.json()) as { escalation_id: string };

    // Resolve it directly via the store
    store.resolve(created.escalation_id, JSON.stringify({ decision: 'allow' }));

    // Get the escalation -- should be resolved
    const res = await fetch(`${baseUrl}/escalations/${created.escalation_id}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; status: string; responseJson: string };
    expect(body.status).toBe('resolved');
    expect(body.responseJson).toBeDefined();
  });

  it('GET /unknown-route returns 404', async () => {
    const res = await fetch(`${baseUrl}/unknown-route`);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not found');
  });
});
