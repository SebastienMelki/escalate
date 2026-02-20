import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  triageWithHeuristic,
  triageStopEvent,
  type TriageConfig,
} from '../../src/intelligence/triage.js';

const DEFAULT_CONFIG: TriageConfig = {
  enabled: true,
  method: 'auto',
  model: 'claude-haiku-4-5-20251001',
  confidenceThreshold: 'low',
};

describe('triageWithHeuristic', () => {
  it('detects question marks as needing input', () => {
    const result = triageWithHeuristic('Which database should I use?');
    expect(result.needsHumanInput).toBe(true);
    expect(result.method).toBe('heuristic');
  });

  it('detects "Would you like" as needing input', () => {
    const result = triageWithHeuristic(
      'Would you like me to proceed with the refactoring?',
    );
    expect(result.needsHumanInput).toBe(true);
  });

  it('detects "Should I" as needing input', () => {
    const result = triageWithHeuristic(
      'Should I also update the tests?',
    );
    expect(result.needsHumanInput).toBe(true);
  });

  it('detects "Do you want" as needing input', () => {
    const result = triageWithHeuristic(
      'Do you want me to deploy this to staging?',
    );
    expect(result.needsHumanInput).toBe(true);
  });

  it('detects "let me know" as needing input', () => {
    const result = triageWithHeuristic(
      'I have two options. Let me know which one you prefer.',
    );
    expect(result.needsHumanInput).toBe(true);
  });

  it('detects "I\'ve completed" as not needing input', () => {
    const result = triageWithHeuristic(
      "I've completed the implementation of the new feature.",
    );
    expect(result.needsHumanInput).toBe(false);
  });

  it('detects "all tests pass" as not needing input', () => {
    const result = triageWithHeuristic(
      'All tests pass and the build is clean.',
    );
    expect(result.needsHumanInput).toBe(false);
  });

  it('detects "successfully created" as not needing input', () => {
    const result = triageWithHeuristic(
      'I successfully created the new API endpoint.',
    );
    expect(result.needsHumanInput).toBe(false);
  });

  it('detects "task complete" as not needing input', () => {
    const result = triageWithHeuristic('The task is complete.');
    expect(result.needsHumanInput).toBe(false);
  });

  it('returns no input needed for empty message', () => {
    const result = triageWithHeuristic('');
    expect(result.needsHumanInput).toBe(false);
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('Empty message');
  });

  it('returns no input needed for whitespace-only message', () => {
    const result = triageWithHeuristic('   \n  ');
    expect(result.needsHumanInput).toBe(false);
    expect(result.confidence).toBe('high');
  });

  it('treats short ambiguous message as not needing input', () => {
    const result = triageWithHeuristic(
      'I noticed some interesting patterns in the codebase.',
    );
    expect(result.needsHumanInput).toBe(false);
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('Short message');
  });

  it('treats short direct answers as not needing input', () => {
    const result = triageWithHeuristic('4');
    expect(result.needsHumanInput).toBe(false);
    expect(result.confidence).toBe('medium');
  });

  it('escalates conservatively on long ambiguous message', () => {
    const longMessage = 'Here is a detailed analysis of the codebase. '.repeat(10);
    const result = triageWithHeuristic(longMessage);
    expect(result.needsHumanInput).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('conservatively');
  });

  it('prioritizes completion over question when both present', () => {
    // Completion patterns are checked first
    const result = triageWithHeuristic(
      "I've completed the work. Any questions?",
    );
    expect(result.needsHumanInput).toBe(false);
  });
});

describe('triageStopEvent', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['ESCALATE_ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns needsHumanInput true when triage is disabled', async () => {
    const config: TriageConfig = { ...DEFAULT_CONFIG, enabled: false };
    const result = await triageStopEvent('Some message', config);
    expect(result.needsHumanInput).toBe(true);
    expect(result.reason).toContain('disabled');
  });

  it('uses heuristic when method is "heuristic"', async () => {
    const config: TriageConfig = { ...DEFAULT_CONFIG, method: 'heuristic' };
    const result = await triageStopEvent(
      "I've completed the task.",
      config,
    );
    expect(result.needsHumanInput).toBe(false);
    expect(result.method).toBe('heuristic');
  });

  it('falls back to heuristic in auto mode with no API key', async () => {
    const config: TriageConfig = { ...DEFAULT_CONFIG, method: 'auto' };
    const result = await triageStopEvent('Should I continue?', config);
    expect(result.needsHumanInput).toBe(true);
    expect(result.method).toBe('heuristic');
  });

  it('returns conservative result when LLM mode requested but no API key', async () => {
    const config: TriageConfig = { ...DEFAULT_CONFIG, method: 'llm' };
    const result = await triageStopEvent('Some message', config);
    expect(result.needsHumanInput).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('no API key');
  });

  it('falls back to heuristic in auto mode when LLM call fails', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const config: TriageConfig = { ...DEFAULT_CONFIG, method: 'auto' };

    // Mock fetch to fail
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network error'),
    );

    const result = await triageStopEvent(
      "I've completed the task.",
      config,
    );
    expect(result.needsHumanInput).toBe(false);
    expect(result.method).toBe('heuristic');

    fetchSpy.mockRestore();
  });

  it('returns conservative result when LLM mode explicitly fails', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const config: TriageConfig = { ...DEFAULT_CONFIG, method: 'llm' };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network error'),
    );

    const result = await triageStopEvent('Should I continue?', config);
    expect(result.needsHumanInput).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('LLM triage failed');

    fetchSpy.mockRestore();
  });

  it('uses ESCALATE_ANTHROPIC_API_KEY over ANTHROPIC_API_KEY', async () => {
    process.env['ESCALATE_ANTHROPIC_API_KEY'] = 'escalate-key';
    process.env['ANTHROPIC_API_KEY'] = 'regular-key';
    const config: TriageConfig = { ...DEFAULT_CONFIG, method: 'llm' };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('escalate-key');
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: '{"needs_human_input": false, "confidence": "high", "reason": "completion"}',
              },
            ],
          }),
          { status: 200 },
        );
      },
    );

    const result = await triageStopEvent('Done.', config);
    expect(result.method).toBe('llm');

    fetchSpy.mockRestore();
  });
});
