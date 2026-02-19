import { describe, it, expect, beforeEach, assert } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { initializeDatabase } from '../../src/state/schema.js';
import { EscalationStore } from '../../src/state/store.js';
import type { FallbackAction } from '../../src/state/types.js';

describe('initializeDatabase', () => {
  it('creates the escalations table', () => {
    const db = new Database(':memory:');
    initializeDatabase(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='escalations'")
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);

    const first = tables[0];
    assert(first !== undefined);
    expect(first.name).toBe('escalations');

    db.close();
  });
});

describe('EscalationStore', () => {
  let db: DatabaseType;
  let store: EscalationStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new EscalationStore(db);
  });

  describe('create', () => {
    it('creates a pending escalation with a generated UUID', () => {
      const record = store.create({
        eventType: 'permissionRequest',
        requestJson: '{"tool":"bash"}',
        fallbackAction: 'deny',
        timeoutSeconds: 300,
      });

      expect(record.id).toBeDefined();
      expect(record.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(record.status).toBe('pending');
      expect(record.eventType).toBe('permissionRequest');
      expect(record.requestJson).toBe('{"tool":"bash"}');
      expect(record.fallbackAction).toBe('deny');
      expect(record.responseJson).toBeNull();
      expect(record.resolvedAt).toBeNull();
      expect(record.createdAt).toBeDefined();
      expect(record.timeoutAt).toBeDefined();
    });
  });

  describe('getById', () => {
    it('returns the escalation record by ID', () => {
      const created = store.create({
        eventType: 'preToolUse',
        requestJson: '{"action":"write"}',
        fallbackAction: 'allow',
        timeoutSeconds: 60,
      });

      const fetched = store.getById(created.id);
      assert(fetched !== undefined);
      expect(fetched.id).toBe(created.id);
      expect(fetched.eventType).toBe('preToolUse');
      expect(fetched.requestJson).toBe('{"action":"write"}');
      expect(fetched.fallbackAction).toBe('allow');
    });

    it('returns undefined for a non-existent ID', () => {
      const result = store.getById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('resolve', () => {
    it('resolves a pending escalation', () => {
      const created = store.create({
        eventType: 'permissionRequest',
        requestJson: '{"tool":"bash"}',
        fallbackAction: 'deny',
        timeoutSeconds: 300,
      });

      const resolved = store.resolve(created.id, '{"decision":"allow"}');
      expect(resolved).toBe(true);

      const fetched = store.getById(created.id);
      assert(fetched !== undefined);
      expect(fetched.status).toBe('resolved');
      expect(fetched.responseJson).toBe('{"decision":"allow"}');
      expect(fetched.resolvedAt).toBeDefined();
    });

    it('returns false when resolving an already-resolved escalation', () => {
      const created = store.create({
        eventType: 'permissionRequest',
        requestJson: '{"tool":"bash"}',
        fallbackAction: 'deny',
        timeoutSeconds: 300,
      });

      store.resolve(created.id, '{"decision":"allow"}');
      const secondResolve = store.resolve(created.id, '{"decision":"deny"}');
      expect(secondResolve).toBe(false);
    });

    it('returns false for a non-existent escalation', () => {
      const result = store.resolve('non-existent-id', '{"decision":"allow"}');
      expect(result).toBe(false);
    });
  });

  describe('checkTimeout', () => {
    it('returns the fallback action when escalation has timed out', () => {
      // Insert directly with a past timeout_at to simulate timeout
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO escalations (id, status, event_type, request_json, fallback_action, created_at, timeout_at)
         VALUES (?, 'pending', 'permissionRequest', '{}', 'deny', datetime('now'), datetime('now', '-1 seconds'))`,
      ).run(id);

      const result = store.checkTimeout(id);
      expect(result).toBe('deny');

      // Status should now be timed_out
      const fetched = store.getById(id);
      assert(fetched !== undefined);
      expect(fetched.status).toBe('timed_out');
    });

    it('returns null when escalation has not timed out', () => {
      const created = store.create({
        eventType: 'permissionRequest',
        requestJson: '{}',
        fallbackAction: 'deny',
        timeoutSeconds: 3600,
      });

      const result = store.checkTimeout(created.id);
      expect(result).toBeNull();
    });

    it('returns null for a non-existent escalation', () => {
      const result = store.checkTimeout('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getPending', () => {
    it('returns all pending escalations ordered by created_at', () => {
      store.create({
        eventType: 'permissionRequest',
        requestJson: '{"order":1}',
        fallbackAction: 'deny',
        timeoutSeconds: 300,
      });

      store.create({
        eventType: 'preToolUse',
        requestJson: '{"order":2}',
        fallbackAction: 'allow',
        timeoutSeconds: 300,
      });

      const resolved = store.create({
        eventType: 'stop',
        requestJson: '{"order":3}',
        fallbackAction: 'ask-again',
        timeoutSeconds: 300,
      });
      store.resolve(resolved.id, '{"resolved":true}');

      const pending = store.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0]).toBeDefined();
      expect(pending[0]?.requestJson).toBe('{"order":1}');
      expect(pending[1]).toBeDefined();
      expect(pending[1]?.requestJson).toBe('{"order":2}');
    });

    it('returns empty array when no pending escalations', () => {
      const pending = store.getPending();
      expect(pending).toHaveLength(0);
    });
  });

  describe('fallback action values', () => {
    it.each<FallbackAction>(['allow', 'deny', 'ask-again'])(
      'handles fallback action "%s"',
      (action) => {
        const record = store.create({
          eventType: 'permissionRequest',
          requestJson: '{}',
          fallbackAction: action,
          timeoutSeconds: 300,
        });

        expect(record.fallbackAction).toBe(action);

        const fetched = store.getById(record.id);
        assert(fetched !== undefined);
        expect(fetched.fallbackAction).toBe(action);
      },
    );
  });
});
