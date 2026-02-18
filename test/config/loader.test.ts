import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { loadConfig, loadSecrets } from '../../src/config/loader.js';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

function fixtureFile(name: string): string {
  return resolve(FIXTURES_DIR, name);
}

beforeEach(() => {
  mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(FIXTURES_DIR, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads and validates a valid config file', () => {
    const configPath = fixtureFile('valid.json');
    writeFileSync(configPath, JSON.stringify({ slack: { channelId: 'C0123456789' } }));

    const result = loadConfig(configPath);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slack.channelId).toBe('C0123456789');
      // Defaults should be applied
      expect(result.data.timeouts.permissionRequest).toBe(600_000);
    }
  });

  it('returns FILE_NOT_FOUND for nonexistent file', () => {
    const result = loadConfig('/nonexistent/path/config.json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('returns INVALID_JSON for malformed JSON', () => {
    const configPath = fixtureFile('malformed.json');
    writeFileSync(configPath, '{ not valid json }}}');

    const result = loadConfig(configPath);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_JSON');
    }
  });

  it('returns VALIDATION_FAILED for invalid schema data', () => {
    const configPath = fixtureFile('invalid-schema.json');
    writeFileSync(configPath, JSON.stringify({ slack: { channelId: '' } }));

    const result = loadConfig(configPath);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('uses default path when no argument provided', () => {
    // loadConfig() with no argument should look for escalate.config.json in cwd
    // Since our cwd doesn't have one, this should return FILE_NOT_FOUND or succeed if it exists
    const result = loadConfig();
    // Just verify it returns a Result (success or failure) -- not a crash
    expect(result).toHaveProperty('success');
  });
});

describe('loadSecrets', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns secrets when both env vars are set', () => {
    process.env['ESCALATE_SLACK_BOT_TOKEN'] = 'xoxb-test-token';
    process.env['ESCALATE_SLACK_APP_TOKEN'] = 'xapp-test-token';

    const result = loadSecrets();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slackBotToken).toBe('xoxb-test-token');
      expect(result.data.slackAppToken).toBe('xapp-test-token');
    }
  });

  it('returns MISSING_ENV_VAR when ESCALATE_SLACK_BOT_TOKEN is missing', () => {
    delete process.env['ESCALATE_SLACK_BOT_TOKEN'];
    process.env['ESCALATE_SLACK_APP_TOKEN'] = 'xapp-test-token';

    const result = loadSecrets();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('MISSING_ENV_VAR');
      expect(result.error.message).toContain('ESCALATE_SLACK_BOT_TOKEN');
    }
  });

  it('returns MISSING_ENV_VAR when ESCALATE_SLACK_APP_TOKEN is missing', () => {
    process.env['ESCALATE_SLACK_BOT_TOKEN'] = 'xoxb-test-token';
    delete process.env['ESCALATE_SLACK_APP_TOKEN'];

    const result = loadSecrets();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('MISSING_ENV_VAR');
      expect(result.error.message).toContain('ESCALATE_SLACK_APP_TOKEN');
    }
  });
});
