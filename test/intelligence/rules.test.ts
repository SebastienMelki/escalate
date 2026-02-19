import { describe, it, expect } from 'vitest';
import {
  evaluateRules,
  extractFilePaths,
  globToRegex,
} from '../../src/intelligence/rules.js';
import type {
  AutoApprovalRule,
  EvaluationInput,
} from '../../src/intelligence/rules.js';

describe('evaluateRules', () => {
  const noRules: readonly AutoApprovalRule[] = [];

  it('short-circuits to escalate when policy is always', () => {
    const input: EvaluationInput = { eventType: 'PermissionRequest' };
    const result = evaluateRules(input, noRules, 'always');
    expect(result.decision).toBe('escalate');
  });

  it('short-circuits to auto_approve when policy is never', () => {
    const input: EvaluationInput = { eventType: 'PermissionRequest' };
    const result = evaluateRules(input, noRules, 'never');
    expect(result.decision).toBe('auto_approve');
  });

  it('returns auto_approve with matchedRule when conditional and tool_name pattern matches', () => {
    const rules: readonly AutoApprovalRule[] = [
      { type: 'tool_name', pattern: 'Read|Glob' },
    ];
    const input: EvaluationInput = { eventType: 'PreToolUse', toolName: 'Read' };
    const result = evaluateRules(input, rules, 'conditional');
    expect(result.decision).toBe('auto_approve');
    expect(result.matchedRule).toEqual({ type: 'tool_name', pattern: 'Read|Glob' });
  });

  it('returns escalate when conditional and no rules match', () => {
    const rules: readonly AutoApprovalRule[] = [
      { type: 'tool_name', pattern: 'Read|Glob' },
    ];
    const input: EvaluationInput = { eventType: 'PreToolUse', toolName: 'Bash' };
    const result = evaluateRules(input, rules, 'conditional');
    expect(result.decision).toBe('escalate');
  });

  it('returns auto_approve when conditional and file_path glob matches', () => {
    const rules: readonly AutoApprovalRule[] = [
      { type: 'file_path', pattern: '**/*.test.ts' },
    ];
    const input: EvaluationInput = {
      eventType: 'PreToolUse',
      toolName: 'Write',
      filePaths: ['src/foo/bar.test.ts'],
    };
    const result = evaluateRules(input, rules, 'conditional');
    expect(result.decision).toBe('auto_approve');
    expect(result.matchedRule).toEqual({ type: 'file_path', pattern: '**/*.test.ts' });
  });

  it('returns escalate when conditional file_path rule does not match', () => {
    const rules: readonly AutoApprovalRule[] = [
      { type: 'file_path', pattern: '**/*.test.ts' },
    ];
    const input: EvaluationInput = {
      eventType: 'PreToolUse',
      toolName: 'Write',
      filePaths: ['src/foo/bar.ts'],
    };
    const result = evaluateRules(input, rules, 'conditional');
    expect(result.decision).toBe('escalate');
  });

  it('matches file_path rule when any file in filePaths matches', () => {
    const rules: readonly AutoApprovalRule[] = [
      { type: 'file_path', pattern: '**/test/**' },
    ];
    const input: EvaluationInput = {
      eventType: 'PreToolUse',
      toolName: 'Write',
      filePaths: ['src/main.ts', 'src/test/foo.ts'],
    };
    const result = evaluateRules(input, rules, 'conditional');
    expect(result.decision).toBe('auto_approve');
  });
});

describe('extractFilePaths', () => {
  it('returns [file_path] for Write tool', () => {
    const result = extractFilePaths('Write', { file_path: '/src/foo.ts', content: 'bar' });
    expect(result).toEqual(['/src/foo.ts']);
  });

  it('returns [file_path] for Edit tool', () => {
    const result = extractFilePaths('Edit', { file_path: '/src/foo.ts', old_string: 'a', new_string: 'b' });
    expect(result).toEqual(['/src/foo.ts']);
  });

  it('returns [file_path] for Read tool', () => {
    const result = extractFilePaths('Read', { file_path: '/src/foo.ts' });
    expect(result).toEqual(['/src/foo.ts']);
  });

  it('returns [] for Bash tool', () => {
    const result = extractFilePaths('Bash', { command: 'ls /src' });
    expect(result).toEqual([]);
  });

  it('returns [] when toolName is undefined', () => {
    const result = extractFilePaths(undefined, { file_path: '/src/foo.ts' });
    expect(result).toEqual([]);
  });

  it('returns [] when file_path is not a string', () => {
    const result = extractFilePaths('Write', { file_path: 123 });
    expect(result).toEqual([]);
  });
});

describe('globToRegex', () => {
  it('converts **/*.test.ts to match src/foo/bar.test.ts', () => {
    const re = globToRegex('**/*.test.ts');
    expect(re.test('src/foo/bar.test.ts')).toBe(true);
  });

  it('converts **/test/** to match src/test/foo.ts', () => {
    const re = globToRegex('**/test/**');
    expect(re.test('src/test/foo.ts')).toBe(true);
  });

  it('converts *.ts to match foo.ts but not src/foo.ts', () => {
    const re = globToRegex('*.ts');
    expect(re.test('foo.ts')).toBe(true);
    expect(re.test('src/foo.ts')).toBe(false);
  });

  it('escapes dots in patterns', () => {
    const re = globToRegex('*.config.ts');
    expect(re.test('vitest.config.ts')).toBe(true);
    expect(re.test('vitestaconfigats')).toBe(false);
  });

  it('handles ? wildcard matching single non-separator character', () => {
    const re = globToRegex('src/?.ts');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/ab.ts')).toBe(false);
    expect(re.test('src/.ts')).toBe(false);
  });
});
