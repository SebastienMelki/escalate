import { describe, it, expect, afterEach, assert } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnownBlock } from '@slack/types';
import type { AuditEntry } from '../../src/intelligence/audit.js';
import type { SessionSummary } from '../../src/intelligence/summary.js';
import { buildSessionSummary, buildSummaryBlocks } from '../../src/intelligence/summary.js';

type HeaderBlock = Extract<KnownBlock, { type: 'header' }>;
type SectionBlock = Extract<KnownBlock, { type: 'section' }>;

function isHeaderBlock(b: KnownBlock): b is HeaderBlock {
  return b.type === 'header';
}
function isSectionBlock(b: KnownBlock): b is SectionBlock {
  return b.type === 'section';
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'summary-test-'));
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

function writeEntries(logPath: string, entries: AuditEntry[]): void {
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(logPath, content, 'utf-8');
}

describe('buildSessionSummary', () => {
  it('returns zero-count summary when logPath does not exist', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'nonexistent.jsonl');

    const summary = buildSessionSummary(logPath);

    expect(summary.totalEvents).toBe(0);
    expect(summary.autoApproved).toBe(0);
    expect(summary.escalated).toBe(0);
    expect(summary.quietHoursSuppressed).toBe(0);
    expect(summary.timedOut).toBe(0);
    expect(summary.notableEvents).toEqual([]);
  });

  it('returns zero-count summary when log is empty', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'empty.jsonl');
    writeFileSync(logPath, '', 'utf-8');

    const summary = buildSessionSummary(logPath);

    expect(summary.totalEvents).toBe(0);
    expect(summary.autoApproved).toBe(0);
    expect(summary.escalated).toBe(0);
    expect(summary.notableEvents).toEqual([]);
  });

  it('counts decision types correctly', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');

    writeEntries(logPath, [
      makeEntry({ decision: 'auto_approved', eventType: 'PreToolUse' }),
      makeEntry({ decision: 'escalated', eventType: 'PermissionRequest' }),
      makeEntry({ decision: 'timed_out', eventType: 'Stop' }),
    ]);

    const summary = buildSessionSummary(logPath);

    expect(summary.totalEvents).toBe(3);
    expect(summary.autoApproved).toBe(1);
    expect(summary.escalated).toBe(1);
    expect(summary.timedOut).toBe(1);
    expect(summary.quietHoursSuppressed).toBe(0);
  });

  it('groups events by eventType in decisionsByType', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');

    writeEntries(logPath, [
      makeEntry({ eventType: 'PreToolUse', decision: 'auto_approved' }),
      makeEntry({ eventType: 'PreToolUse', decision: 'escalated' }),
      makeEntry({ eventType: 'PermissionRequest', decision: 'auto_approved' }),
      makeEntry({ eventType: 'Stop', decision: 'timed_out' }),
    ]);

    const summary = buildSessionSummary(logPath);

    expect(summary.decisionsByType['PreToolUse']).toBe(2);
    expect(summary.decisionsByType['PermissionRequest']).toBe(1);
    expect(summary.decisionsByType['Stop']).toBe(1);
  });

  it('identifies notable events: timed_out and PostToolUseFailure', () => {
    const dir = getTempDir();
    const logPath = join(dir, 'audit.jsonl');

    writeEntries(logPath, [
      makeEntry({ decision: 'auto_approved', eventType: 'PreToolUse', reason: 'OK' }),
      makeEntry({ decision: 'timed_out', eventType: 'Stop', reason: 'No response in 30s' }),
      makeEntry({
        decision: 'escalated',
        eventType: 'PostToolUseFailure',
        toolName: 'Bash',
        reason: 'Exit code 1',
      }),
    ]);

    const summary = buildSessionSummary(logPath);

    expect(summary.notableEvents).toHaveLength(2);
    expect(summary.notableEvents.some((e) => e.includes('timed_out'))).toBe(true);
    expect(summary.notableEvents.some((e) => e.includes('PostToolUseFailure'))).toBe(true);
  });
});

describe('buildSummaryBlocks', () => {
  function makeZeroSummary(): SessionSummary {
    return {
      totalEvents: 0,
      autoApproved: 0,
      escalated: 0,
      quietHoursSuppressed: 0,
      timedOut: 0,
      decisionsByType: {},
      notableEvents: [],
    };
  }

  it('returns a KnownBlock array with header "Session Summary"', () => {
    const blocks = buildSummaryBlocks(makeZeroSummary());

    expect(blocks.length).toBeGreaterThan(0);
    const header = blocks[0];
    assert(header !== undefined);
    assert(isHeaderBlock(header));
    expect(header.text.text).toBe('Session Summary');
  });

  it('includes section block with stats', () => {
    const summary: SessionSummary = {
      totalEvents: 5,
      autoApproved: 3,
      escalated: 1,
      quietHoursSuppressed: 0,
      timedOut: 1,
      decisionsByType: { PreToolUse: 5 },
      notableEvents: [],
    };

    const blocks = buildSummaryBlocks(summary);
    const sections = blocks.filter(isSectionBlock);

    // At least one section should have stats
    const statsSection = sections.find(
      (s) => s.text !== undefined && s.text.text.includes('Total:'),
    );
    assert(statsSection !== undefined);
    assert(statsSection.text !== undefined);
    expect(statsSection.text.text).toContain('5');
    expect(statsSection.text.text).toContain('Auto-approved:');
    expect(statsSection.text.text).toContain('Escalated:');
  });

  it('includes notable events section when present', () => {
    const summary: SessionSummary = {
      totalEvents: 2,
      autoApproved: 1,
      escalated: 1,
      quietHoursSuppressed: 0,
      timedOut: 0,
      decisionsByType: { PreToolUse: 2 },
      notableEvents: ['timed_out: Stop - No response', 'PostToolUseFailure: Bash - Exit code 1'],
    };

    const blocks = buildSummaryBlocks(summary);
    const sections = blocks.filter(isSectionBlock);

    const notableSection = sections.find(
      (s) => s.text !== undefined && s.text.text.includes('Notable'),
    );
    assert(notableSection !== undefined);
    assert(notableSection.text !== undefined);
    expect(notableSection.text.text).toContain('timed_out');
    expect(notableSection.text.text).toContain('PostToolUseFailure');
  });

  it('handles empty summary gracefully with "No events recorded"', () => {
    const blocks = buildSummaryBlocks(makeZeroSummary());
    const sections = blocks.filter(isSectionBlock);

    const noEventsSection = sections.find(
      (s) => s.text !== undefined && s.text.text.includes('No escalation events recorded'),
    );
    assert(noEventsSection !== undefined);
  });

  it('includes event type breakdown when decisionsByType is non-empty', () => {
    const summary: SessionSummary = {
      totalEvents: 3,
      autoApproved: 2,
      escalated: 1,
      quietHoursSuppressed: 0,
      timedOut: 0,
      decisionsByType: { PreToolUse: 2, PermissionRequest: 1 },
      notableEvents: [],
    };

    const blocks = buildSummaryBlocks(summary);
    const sections = blocks.filter(isSectionBlock);

    const breakdownSection = sections.find(
      (s) => s.text !== undefined && s.text.text.includes('PreToolUse'),
    );
    assert(breakdownSection !== undefined);
    assert(breakdownSection.text !== undefined);
    expect(breakdownSection.text.text).toContain('PermissionRequest');
  });
});
