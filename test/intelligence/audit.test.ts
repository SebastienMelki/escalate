import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditEntry } from '../../src/intelligence/audit.js';
import { appendAuditEntry, readAuditLog } from '../../src/intelligence/audit.js';

/** Create a unique temp directory for each test run. */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'audit-test-'));
}

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function getTempDir(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  return dir;
}

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: '2026-02-19T18:00:00.000Z',
    eventType: 'PreToolUse',
    decision: 'auto_approved',
    reason: 'Rule matched',
    ...overrides,
  };
}

describe('appendAuditEntry', () => {
  it('writes one JSON line to a file', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');
    const entry = makeEntry();

    appendAuditEntry(logPath, entry);

    const raw = readFileSync(logPath, 'utf-8').trim();
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toEqual(entry);
  });

  it('appends multiple entries on separate lines', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');

    const entry1 = makeEntry({ decision: 'auto_approved' });
    const entry2 = makeEntry({ decision: 'escalated', reason: 'Dangerous tool' });

    appendAuditEntry(logPath, entry1);
    appendAuditEntry(logPath, entry2);

    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed1: unknown = JSON.parse(lines[0]!);
    const parsed2: unknown = JSON.parse(lines[1]!);
    expect(parsed1).toEqual(entry1);
    expect(parsed2).toEqual(entry2);
  });

  it('creates parent directories if they do not exist', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'nested', 'deep', 'audit.jsonl');
    const entry = makeEntry();

    appendAuditEntry(logPath, entry);

    const raw = readFileSync(logPath, 'utf-8').trim();
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toEqual(entry);
  });
});

describe('readAuditLog', () => {
  it('returns empty array when log file does not exist', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'nonexistent.jsonl');

    const result = readAuditLog(logPath);

    expect(result).toEqual([]);
  });

  it('returns parsed AuditEntry array from JSONL file', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');

    const entry1 = makeEntry({ decision: 'auto_approved' });
    const entry2 = makeEntry({ decision: 'escalated', reason: 'Needs review' });
    const entry3 = makeEntry({ decision: 'timed_out', reason: 'No response' });

    const content = [entry1, entry2, entry3].map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(logPath, content, 'utf-8');

    const result = readAuditLog(logPath);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(entry1);
    expect(result[1]).toEqual(entry2);
    expect(result[2]).toEqual(entry3);
  });

  it('skips empty lines for trailing newline robustness', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');

    const entry = makeEntry();
    // Write with extra trailing newlines
    writeFileSync(logPath, JSON.stringify(entry) + '\n\n\n', 'utf-8');

    const result = readAuditLog(logPath);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry);
  });

  it('each AuditEntry has timestamp, eventType, decision, and reason fields', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');

    const entry = makeEntry({
      timestamp: '2026-02-19T12:00:00Z',
      eventType: 'PostToolUseFailure',
      decision: 'escalated',
      reason: 'Tool failed',
      toolName: 'Bash',
      filePaths: ['src/main.ts'],
      matchedRule: 'dangerous-tool',
      escalationId: 'esc-123',
    });
    writeFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');

    const result = readAuditLog(logPath);
    const parsed = result[0]!;

    expect(parsed.timestamp).toBe('2026-02-19T12:00:00Z');
    expect(parsed.eventType).toBe('PostToolUseFailure');
    expect(parsed.decision).toBe('escalated');
    expect(parsed.reason).toBe('Tool failed');
    expect(parsed.toolName).toBe('Bash');
    expect(parsed.filePaths).toEqual(['src/main.ts']);
    expect(parsed.matchedRule).toBe('dangerous-tool');
    expect(parsed.escalationId).toBe('esc-123');
  });
});
