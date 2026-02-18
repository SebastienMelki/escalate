/**
 * Config file loading and secret validation.
 *
 * Loads escalate.config.json from disk, validates it against the Zod schema,
 * and provides environment variable secret loading for Slack tokens.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EscalateConfigSchema } from './schema.js';
import type { EscalateConfig } from './schema.js';
import { ok, err } from '../errors/result.js';
import type { Result } from '../errors/result.js';

/** Structured error returned by config loading operations. */
export interface ConfigError {
  readonly code: 'FILE_NOT_FOUND' | 'INVALID_JSON' | 'VALIDATION_FAILED' | 'MISSING_ENV_VAR';
  readonly message: string;
  readonly details?: unknown;
}

/** Secrets loaded from environment variables (never stored in config files). */
export interface ConfigSecrets {
  readonly slackBotToken: string;
  readonly slackAppToken: string;
}

/**
 * Load and validate an escalate.config.json file.
 *
 * @param configPath - Path to config file. Defaults to `escalate.config.json` in cwd.
 * @returns A Result containing the validated config or a ConfigError.
 */
export function loadConfig(configPath?: string): Result<EscalateConfig, ConfigError> {
  const resolvedPath = configPath ?? resolve(process.cwd(), 'escalate.config.json');

  // Check file exists
  if (!existsSync(resolvedPath)) {
    return err({
      code: 'FILE_NOT_FOUND',
      message: `Config file not found: ${resolvedPath}`,
    });
  }

  // Read and parse JSON
  let raw: unknown;
  try {
    const contents = readFileSync(resolvedPath, 'utf-8');
    raw = JSON.parse(contents) as unknown;
  } catch (error) {
    return err({
      code: 'INVALID_JSON',
      message: `Failed to parse config file as JSON: ${resolvedPath}`,
      details: error,
    });
  }

  // Validate against schema
  const result = EscalateConfigSchema.safeParse(raw);
  if (!result.success) {
    return err({
      code: 'VALIDATION_FAILED',
      message: `Config validation failed: ${resolvedPath}`,
      details: result.error,
    });
  }

  return ok(result.data);
}

/**
 * Load secrets from environment variables.
 *
 * Secrets are never stored in config files. This function reads them
 * from the process environment and returns a structured error if missing.
 *
 * @returns A Result containing the secrets or a ConfigError.
 */
export function loadSecrets(): Result<ConfigSecrets, ConfigError> {
  const botToken = process.env['ESCALATE_SLACK_BOT_TOKEN'];
  if (botToken === undefined || botToken === '') {
    return err({
      code: 'MISSING_ENV_VAR',
      message: 'Required environment variable ESCALATE_SLACK_BOT_TOKEN is not set',
    });
  }

  const appToken = process.env['ESCALATE_SLACK_APP_TOKEN'];
  if (appToken === undefined || appToken === '') {
    return err({
      code: 'MISSING_ENV_VAR',
      message: 'Required environment variable ESCALATE_SLACK_APP_TOKEN is not set',
    });
  }

  return ok({
    slackBotToken: botToken,
    slackAppToken: appToken,
  });
}
