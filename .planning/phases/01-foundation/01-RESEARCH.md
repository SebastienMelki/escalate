# Phase 1: Foundation - Research

**Researched:** 2026-02-18
**Domain:** ESM TypeScript project skeleton, strict linting, config schema, adapter interface, build tooling
**Confidence:** HIGH

## Summary

Phase 1 establishes the project skeleton that every subsequent phase imports from. The research covers six domains: (1) ESM TypeScript project configuration with pnpm, (2) strict TypeScript compiler settings, (3) ESLint with typescript-eslint strict rules and Prettier formatting, (4) Zod 4 schema validation for config loading, (5) the MessagingAdapter interface design and escalation data shape, and (6) error handling strategy.

All library versions were verified against the npm registry on 2026-02-18. The MCP SDK's ESM-only constraint is the primary architectural driver -- it forces `"type": "module"` in package.json, ESM-compatible tsconfig, and ESM output from the bundler. Every tool choice flows from this constraint.

**Primary recommendation:** Start with a pure ESM project (`"type": "module"`), pnpm, TypeScript 5.9 with `nodenext` module resolution, tsup for bundling, ESLint 10 with typescript-eslint `strictTypeChecked`, and Zod 4 for config schema validation. Use a lightweight Result type for adapter error reporting (Claude's discretion area).

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- Config file location: Claude's discretion (pick based on Claude Code plugin conventions)
- Moderate configurability in v1: Slack config + timeouts + which events to escalate -- enough to customize behavior, sensible defaults for everything else
- Secrets (Slack tokens, API keys) always come from environment variables -- config file never contains secrets
- Single config, one Slack workspace -- no profile switching in v1
- 3 urgency tiers: info / warning / critical -- affects display and quiet hours filtering
- Rich context in escalations: event type + question + tool name + file paths + recent task context -- enough to decide from your phone
- Escalations define suggested actions (e.g., approve/deny/snooze) AND accept free-form text as fallback -- typed actions with free-form escape hatch
- Adapter failure reporting strategy: Claude's discretion (pick based on TypeScript best practices)
- When Slack is unreachable: queue escalations locally, retry when connection restores
- If all retries exhaust: always block -- if we can't reach the human, Claude can't proceed (safety first)
- Error verbosity/debug context level: Claude's discretion
- Source organized by grouped modules: src/config/, src/adapters/, src/types/, src/hooks/ -- organized by domain from the start
- Test framework: Vitest (ESM-native, fast, Jest-compatible API)
- Package manager: pnpm
- Formatting: Prettier for formatting + ESLint for logic rules

### Claude's Discretion

- Config file location (based on plugin conventions)
- Error handling pattern (Result types vs exceptions)
- Error verbosity and debug context level
- Exact TypeScript compiler options beyond the required strict flags
- Internal module export strategy (barrel files, direct imports, etc.)

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                            | Research Support                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAT-01 | MCP server runs with stdio transport as Claude Code plugin process                                                     | `.mcp.json` config pattern documented; `@modelcontextprotocol/sdk` 1.27.0 with `StdioServerTransport` verified; ESM-only constraint drives project setup                           |
| PLAT-02 | MessagingAdapter interface defined with sendEscalation, waitForResponse, sendFollowUp, isConnected methods             | Interface pattern documented with code example; urgency tiers and action types from CONTEXT.md integrated into EscalationRequest type                                              |
| PLAT-06 | Aggressive TypeScript linting -- strict tsconfig, ESLint with @typescript-eslint/strict, no-any rules                  | Full tsconfig with strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes documented; ESLint 10 flat config with strictTypeChecked + no-explicit-any error rule documented |
| CFG-01  | All non-secret settings in escalate.config.json -- escalation rules, channel preferences, timeout values               | Zod 4 schema validation pattern documented; config file location recommendation made (plugin root); complete config schema shape defined                                           |
| CFG-04  | All secrets via environment variables (ESCALATE_SLACK_BOT_TOKEN, ESCALATE_SLACK_APP_TOKEN) -- no hardcoded credentials | Config schema separates secrets (env vars) from settings (config file); Zod schema validates only non-secret config; environment variable loading pattern documented               |

</phase_requirements>

## Standard Stack

### Core

| Library                   | Version | Purpose                                    | Why Standard                                                                                                                                                        |
| ------------------------- | ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                | 5.9.3   | Language / type checker                    | Latest stable; ESM-native; strict mode family covers all required flags                                                                                             |
| pnpm                      | 10.30.0 | Package manager                            | User-locked decision; fast installs, strict node_modules isolation                                                                                                  |
| tsup                      | 8.5.1   | TypeScript bundler (ESM output)            | Requirements explicitly reference tsup; esbuild-based, zero-config ESM output; still functional despite maintenance-mode status                                     |
| zod                       | 4.3.6   | Config schema validation                   | MCP SDK peer dependency (`^3.25 \|\| ^4.0`); 57% smaller than v3, 6.5x faster object parsing; used for config validation AND MCP tool input schemas in later phases |
| vitest                    | 4.0.18  | Test framework                             | User-locked decision; ESM-native, TypeScript-first, fast                                                                                                            |
| eslint                    | 10.0.0  | Linting (logic rules)                      | Latest major; flat config only; typescript-eslint 8.56 already supports it                                                                                          |
| typescript-eslint         | 8.56.0  | TypeScript-specific lint rules             | Provides `strictTypeChecked` config; supports ESLint 10; includes `no-explicit-any`                                                                                 |
| prettier                  | 3.8.1   | Code formatting                            | User-locked decision; Prettier for formatting, ESLint for logic                                                                                                     |
| @modelcontextprotocol/sdk | 1.27.0  | MCP server (placeholder import in Phase 1) | Required for PLAT-01; ESM-only; drives project module format                                                                                                        |

### Supporting

| Library                | Version | Purpose                                              | When to Use                                  |
| ---------------------- | ------- | ---------------------------------------------------- | -------------------------------------------- |
| @tsconfig/node22       | latest  | Base tsconfig for Node 22                            | Extend as base, then add strict flags on top |
| @eslint/js             | 10.0.1  | ESLint core recommended rules                        | Base JS rules that typescript-eslint extends |
| eslint-config-prettier | 10.1.8  | Disable formatting rules that conflict with Prettier | Must be last in ESLint config array          |
| @types/node            | 22.x    | Node.js type definitions                             | Required for process, fs, path types         |

### Alternatives Considered

| Instead of     | Could Use                      | Tradeoff                                                                                                                                                                                                                |
| -------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsup 8.5.1     | tsdown 0.20.3 (Rolldown-based) | tsup is in maintenance mode and recommends tsdown; however tsdown is pre-1.0 (0.20.x), tsup is explicitly in requirements, and tsup 8.5.1 works correctly. **Stick with tsup for now.** Flag for Phase 7 re-evaluation. |
| ESLint 10      | ESLint 9.39.2                  | ESLint 10 released 2026-02-06 (12 days old); typescript-eslint already supports it; new project with no migration burden. ESLint 9 is safe fallback if any ecosystem tool lags.                                         |
| Zod 4.3.6      | Zod 3.x                        | MCP SDK accepts both (`^3.25 \|\| ^4.0`); Zod 4 is dramatically faster and smaller; no reason to use v3 for a new project                                                                                               |
| pino (logging) | console.error                  | pino not needed in Phase 1 (no runtime code). Defer to Phase 2 when MCP server needs stderr-only structured logging.                                                                                                    |

**Installation (Phase 1 only):**

```bash
# Runtime dependencies
pnpm add zod

# Dev dependencies
pnpm add -D typescript tsup vitest eslint @eslint/js typescript-eslint eslint-config-prettier prettier @types/node @tsconfig/node22
```

Note: `@modelcontextprotocol/sdk` is listed in project research (STACK.md) but should NOT be installed in Phase 1 -- it is needed only when the MCP server is built (Phase 2). Phase 1 defines types and interfaces only.

## Architecture Patterns

### Recommended Project Structure

```
escalate/
├── .claude-plugin/
│   └── plugin.json               # Plugin manifest (name only for Phase 1)
├── src/
│   ├── types/
│   │   ├── escalation.ts         # EscalationRequest, UserResponse, UrgencyLevel, SuggestedAction
│   │   ├── adapter.ts            # MessagingAdapter interface
│   │   └── index.ts              # Barrel re-export
│   ├── config/
│   │   ├── schema.ts             # Zod schema for escalate.config.json
│   │   ├── loader.ts             # Load, validate, merge defaults
│   │   ├── defaults.ts           # Default config values
│   │   └── index.ts              # Barrel re-export
│   ├── errors/
│   │   └── result.ts             # Result<T, E> type (lightweight, no library)
│   └── index.ts                  # Root barrel (optional -- see export strategy)
├── test/
│   ├── config/
│   │   ├── schema.test.ts        # Zod schema validation tests
│   │   └── loader.test.ts        # Config loading tests
│   └── types/
│       └── adapter.test.ts       # Type-level tests (compile-only)
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── eslint.config.ts              # Flat config (ESLint 10)
├── .prettierrc                   # Prettier config
├── vitest.config.ts
└── escalate.config.json          # Example/default config file
```

### Pattern 1: Pure ESM Project Configuration

**What:** Set `"type": "module"` in package.json, use `"module": "nodenext"` in tsconfig, output ESM from tsup. This is a non-negotiable constraint from the MCP SDK.

**When to use:** Always. The entire project must be ESM.

**Example -- package.json (relevant fields):**

```json
{
  "name": "escalate",
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Pattern 2: Strict TypeScript Configuration

**What:** Extend `@tsconfig/node22` then add the three required strict flags beyond `strict: true`.

**When to use:** Always. This is a locked requirement (PLAT-06).

**Example -- tsconfig.json:**

```json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Key flags explained:**

- `strict: true` -- enables strictNullChecks, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, noImplicitAny, noImplicitThis, alwaysStrict, useUnknownInCatchVariables
- `noUncheckedIndexedAccess` -- array/record index access returns `T | undefined`, not `T`
- `exactOptionalPropertyTypes` -- `foo?: string` means "may be absent" but NOT "may be undefined" unless explicitly `foo?: string | undefined`
- `verbatimModuleSyntax` -- enforces `import type` for type-only imports (required for ESM correctness)
- `isolatedModules` -- ensures compatibility with single-file transpilers like esbuild/tsup

### Pattern 3: ESLint Flat Config with Strict TypeScript Rules

**What:** ESLint 10 flat config using typescript-eslint `strictTypeChecked` preset, `no-explicit-any` as error, and eslint-config-prettier to disable formatting conflicts.

**When to use:** Always. Locked requirement (PLAT-06).

**Example -- eslint.config.ts:**

```typescript
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  eslintConfigPrettier,
);
```

**Key points:**

- `strictTypeChecked` is a superset of `strict` that adds type-aware rules
- `projectService: true` enables type-checked linting via the TypeScript language service
- `eslint-config-prettier/flat` MUST be last to disable formatting-related rules
- The `no-explicit-any` rule is already included in `strictTypeChecked` but set explicitly to `error` for clarity
- `no-unsafe-*` family catches accidental `any` propagation

### Pattern 4: Config Schema with Zod 4

**What:** Define a Zod 4 schema for `escalate.config.json` that validates all non-secret settings. Secrets come from environment variables, validated separately.

**When to use:** Config loading in `src/config/loader.ts`.

**Example -- src/config/schema.ts:**

```typescript
import * as z from 'zod';

export const UrgencyLevelSchema = z.enum(['info', 'warning', 'critical']);

export const SlackConfigSchema = z.object({
  channelId: z.string().min(1).describe('Slack channel ID for escalations'),
  defaultUrgency: UrgencyLevelSchema.default('warning'),
});

export const TimeoutConfigSchema = z.object({
  permissionRequestMs: z.number().int().min(1000).default(600_000), // 10 min
  preToolUseMs: z.number().int().min(1000).default(300_000), // 5 min
  stopMs: z.number().int().min(1000).default(600_000), // 10 min
  postToolUseFailureMs: z.number().int().min(1000).default(60_000), // 1 min
});

export const EscalationPolicySchema = z.enum(['always', 'never', 'conditional']);

export const EventEscalationConfigSchema = z.object({
  permissionRequest: EscalationPolicySchema.default('always'),
  preToolUse: EscalationPolicySchema.default('conditional'),
  stop: EscalationPolicySchema.default('always'),
  postToolUseFailure: EscalationPolicySchema.default('always'),
});

export const EscalateConfigSchema = z.object({
  slack: SlackConfigSchema,
  timeouts: TimeoutConfigSchema.default({}),
  escalation: EventEscalationConfigSchema.default({}),
});

export type EscalateConfig = z.infer<typeof EscalateConfigSchema>;
```

**Example -- src/config/loader.ts:**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EscalateConfigSchema, type EscalateConfig } from './schema.js';
import { ok, err, type Result } from '../errors/result.js';

export interface ConfigError {
  code: 'FILE_NOT_FOUND' | 'INVALID_JSON' | 'VALIDATION_FAILED' | 'MISSING_ENV_VAR';
  message: string;
  details?: unknown;
}

export function loadConfig(configPath?: string): Result<EscalateConfig, ConfigError> {
  const resolvedPath = configPath ?? resolve(process.cwd(), 'escalate.config.json');

  if (!existsSync(resolvedPath)) {
    return err({
      code: 'FILE_NOT_FOUND',
      message: `Config file not found: ${resolvedPath}`,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  } catch (e) {
    return err({
      code: 'INVALID_JSON',
      message: `Failed to parse config file: ${resolvedPath}`,
      details: e,
    });
  }

  const result = EscalateConfigSchema.safeParse(raw);
  if (!result.success) {
    return err({
      code: 'VALIDATION_FAILED',
      message: 'Config validation failed',
      details: result.error,
    });
  }

  return ok(result.data);
}

export function loadSecrets(): Result<
  { slackBotToken: string; slackAppToken: string },
  ConfigError
> {
  const slackBotToken = process.env['ESCALATE_SLACK_BOT_TOKEN'];
  const slackAppToken = process.env['ESCALATE_SLACK_APP_TOKEN'];

  if (!slackBotToken) {
    return err({
      code: 'MISSING_ENV_VAR',
      message: 'ESCALATE_SLACK_BOT_TOKEN environment variable is required',
    });
  }
  if (!slackAppToken) {
    return err({
      code: 'MISSING_ENV_VAR',
      message: 'ESCALATE_SLACK_APP_TOKEN environment variable is required',
    });
  }

  return ok({ slackBotToken, slackAppToken });
}
```

### Pattern 5: Lightweight Result Type (No Library)

**What:** A minimal discriminated union Result type. No library dependency -- just a type and two constructor functions.

**When to use:** For operations that can fail in expected ways (config loading, adapter operations). Do NOT use for programming errors (those should throw).

**Recommendation (Claude's Discretion):** Use a lightweight custom Result type rather than `neverthrow` or plain exceptions. Rationale:

- `neverthrow` adds a dependency and learning curve for a pattern that needs only ~15 lines of code
- Plain exceptions hide failure modes from type signatures -- callers cannot know a function may fail without reading its source
- The Result pattern makes failure explicit in the type system, which aligns with the project's strict TypeScript philosophy
- Reserve `throw` for truly exceptional conditions (programmer errors, invariant violations)

**Example -- src/errors/result.ts:**

```typescript
export type Result<T, E> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success;
}

export function isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return !result.success;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.success ? result.data : fallback;
}
```

### Pattern 6: MessagingAdapter Interface

**What:** The adapter interface that all messaging platforms implement. Defined in Phase 1 so downstream phases can import and implement it.

**When to use:** This interface is the contract between the escalation engine and platform-specific adapters.

**Example -- src/types/adapter.ts:**

```typescript
import type { EscalationRequest, UserResponse } from './escalation.js';

export interface MessagingAdapter {
  /** Send an escalation message. Returns a unique escalation ID for tracking. */
  sendEscalation(request: EscalationRequest): Promise<string>;

  /** Wait for a user response to a specific escalation. Returns the response or times out. */
  waitForResponse(escalationId: string, timeoutMs: number): Promise<UserResponse>;

  /** Send a follow-up message to an existing escalation thread. */
  sendFollowUp(escalationId: string, message: string): Promise<void>;

  /** Check if the adapter is currently connected to the messaging platform. */
  isConnected(): boolean;
}
```

**Example -- src/types/escalation.ts:**

```typescript
export type UrgencyLevel = 'info' | 'warning' | 'critical';

export type ResponseType = 'action' | 'text' | 'timeout';

export interface SuggestedAction {
  readonly id: string; // e.g., 'approve', 'deny', 'snooze'
  readonly label: string; // Display text for button
  readonly style?: 'primary' | 'danger' | 'default';
}

export interface EscalationContext {
  readonly eventType: string; // e.g., 'PermissionRequest', 'PreToolUse'
  readonly toolName?: string; // e.g., 'Bash', 'Write'
  readonly filePaths?: readonly string[];
  readonly taskContext?: string; // Recent task/phase context
}

export interface EscalationRequest {
  readonly title: string;
  readonly question: string;
  readonly urgency: UrgencyLevel;
  readonly context: EscalationContext;
  readonly suggestedActions: readonly SuggestedAction[];
  readonly allowFreeformResponse: boolean;
}

export interface UserResponse {
  readonly type: ResponseType;
  readonly actionId?: string; // Which suggested action was chosen
  readonly text?: string; // Free-form text or action label
  readonly respondedAt: Date;
}

export interface EscalationTimeout {
  readonly type: 'timeout';
  readonly timeoutMs: number;
  readonly fallbackAction: 'block'; // Always block when unreachable (locked decision)
}
```

### Anti-Patterns to Avoid

- **Slack-specific types in the adapter interface:** The `MessagingAdapter` and `EscalationRequest` types must NOT reference Block Kit, Slack channels, or thread_ts. Those are Slack adapter implementation details. The interface uses platform-agnostic concepts (urgency, actions, text).

- **Secrets in config file:** The Zod schema for `escalate.config.json` must NOT have fields for tokens or API keys. Secrets are loaded separately from environment variables via `loadSecrets()`.

- **CommonJS in any source file:** With `"type": "module"` in package.json, every `.ts` file is ESM. Do not use `require()`, `module.exports`, or `__dirname`. Use `import`, `export`, and `import.meta.url`.

- **Barrel files that re-export everything:** Do NOT create a single `src/index.ts` that re-exports all modules. This defeats tree-shaking and creates circular dependency risk. Instead, use per-domain barrels (`src/types/index.ts`, `src/config/index.ts`) and let consumers import from the specific domain.

## Don't Hand-Roll

| Problem                  | Don't Build                       | Use Instead                              | Why                                                                                                                                                                   |
| ------------------------ | --------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config schema validation | Custom JSON validator             | Zod 4 `safeParse()`                      | Edge cases: nested objects, default values, type coercion, error messages. Zod handles all of these and infers TypeScript types from schemas.                         |
| TypeScript linting rules | Custom AST checks                 | `@typescript-eslint/strict-type-checked` | 100+ rules maintained by the typescript-eslint team; covers `no-explicit-any`, `no-unsafe-*`, strict boolean expressions, and dozens more.                            |
| ESM module resolution    | Manual `.js` extension rewriting  | tsup bundler + `verbatimModuleSyntax`    | TypeScript ESM requires `.js` extensions in imports even for `.ts` files when not bundled. tsup handles this during bundling.                                         |
| Code formatting          | ESLint formatting rules           | Prettier                                 | Formatting debates are endless. Prettier is opinionated and consistent. ESLint formatting rules conflict with Prettier -- use eslint-config-prettier to disable them. |
| Node.js tsconfig base    | Manual target/lib/module settings | `@tsconfig/node22`                       | Maintained by the TypeScript team; correct `lib`, `target`, and `module` for Node 22.                                                                                 |

**Key insight:** Phase 1 is all configuration and type definitions. The temptation is to "just write it by hand." But config validation, linting, and module resolution have deep edge cases that established tools handle correctly. Hand-rolling these leads to subtle bugs that surface in later phases.

## Common Pitfalls

### Pitfall 1: ESM Import Extensions

**What goes wrong:** TypeScript files import from `'./foo'` without a `.js` extension. This works during development with tsx but fails at runtime with Node.js ESM resolution.
**Why it happens:** TypeScript historically resolved imports without extensions. ESM requires explicit file extensions.
**How to avoid:** When NOT using a bundler for runtime, all imports must use `.js` extensions (e.g., `import { foo } from './foo.js'`). Since we use tsup for bundling, this is handled automatically in dist output. However, test files run via vitest (which resolves bare specifiers) so this is less of a concern for tests.
**Warning signs:** `ERR_MODULE_NOT_FOUND` errors when running built output directly.

### Pitfall 2: exactOptionalPropertyTypes Strictness

**What goes wrong:** Code that assigns `undefined` to an optional property fails to compile.
**Why it happens:** With `exactOptionalPropertyTypes: true`, `foo?: string` means the property can be absent but NOT explicitly set to `undefined`. To allow both, you must write `foo?: string | undefined`.
**How to avoid:** Be intentional about optional vs undefined-able. Use `foo?: string` when the property should be omitted entirely. Use `foo?: string | undefined` when explicitly setting to undefined is valid.
**Warning signs:** "Type 'undefined' is not assignable to type 'string'" on optional properties.

### Pitfall 3: noUncheckedIndexedAccess and Array Iteration

**What goes wrong:** Array element access `arr[0]` returns `T | undefined`, breaking code that assumes elements exist.
**Why it happens:** `noUncheckedIndexedAccess` is intentionally strict -- runtime arrays can be empty.
**How to avoid:** Use destructuring with existence checks, `.at()` method, or explicit non-null assertions when safety is guaranteed. Prefer `for...of` loops over index-based access.
**Warning signs:** Excessive `!` non-null assertions; long chains of `if (x !== undefined)` checks.

### Pitfall 4: Zod 4 API Changes from Zod 3

**What goes wrong:** Using Zod 3 patterns that changed in Zod 4 (e.g., `message` parameter, `.nonempty()` behavior, function schema API).
**Why it happens:** Most online examples and training data reference Zod 3.
**How to avoid:** Use `error` parameter instead of `message` for custom errors. `.nonempty()` now behaves like `.min(1)` and infers `T[]` not `[T, ...T[]]`. Refer to Zod 4 migration guide.
**Warning signs:** Type inference produces unexpected results; deprecation warnings from Zod.

### Pitfall 5: ESLint Flat Config Ordering

**What goes wrong:** Prettier-conflicting ESLint rules fire, causing formatting fights between ESLint and Prettier.
**Why it happens:** `eslint-config-prettier` must be the LAST config in the flat config array to disable conflicting rules.
**How to avoid:** Always put `eslintConfigPrettier` as the final element in the config array.
**Warning signs:** `eslint --fix` and `prettier --write` produce different output on the same file.

### Pitfall 6: tsup Not Generating Declaration Files

**What goes wrong:** tsup builds JavaScript but no `.d.ts` files, causing downstream type errors.
**Why it happens:** tsup's `dts: true` option uses a separate TypeScript process for declarations. If `tsconfig.json` has errors or `declaration: true` is not set, dts generation silently fails.
**How to avoid:** Ensure `tsconfig.json` has `"declaration": true` and `"declarationMap": true`. Set `dts: true` in `tsup.config.ts`. Test that `dist/` contains both `.js` and `.d.ts` files after build.
**Warning signs:** `dist/` contains only `.js` files; no `.d.ts` alongside them.

## Code Examples

Verified patterns from official sources:

### tsup Configuration for ESM-Only Output

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
});
```

Source: tsup official documentation (tsup.egoist.dev), verified against npm registry

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
    },
  },
});
```

Source: Vitest documentation (vitest.dev)

### Prettier Configuration

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Plugin Manifest (Phase 1 Minimal)

```json
{
  "name": "escalate",
  "version": "0.1.0",
  "description": "Smart escalation bridge between Claude Code and messaging platforms"
}
```

Source: Claude Code Plugins Reference (code.claude.com/docs/en/plugins-reference)

### Config File Location Decision (Claude's Discretion)

**Recommendation:** Place `escalate.config.json` at the plugin root directory (same level as `package.json` and `.claude-plugin/`).

**Rationale:**

- Claude Code plugins are copied to `~/.claude/plugins/cache/` after installation. The config file must be inside the plugin root to survive this copy.
- The `.mcp.json` pattern in Claude Code uses `${CLAUDE_PLUGIN_ROOT}` for paths. The config loader should use this same variable: `${CLAUDE_PLUGIN_ROOT}/escalate.config.json`.
- Other plugins (hookify, ralph-loop) keep their configuration at the plugin root level.
- Users edit the config file in the plugin directory, which is the natural location they discover first.

### Export Strategy Decision (Claude's Discretion)

**Recommendation:** Use per-domain barrel files with direct imports for cross-domain references.

```
src/types/index.ts       -- re-exports from escalation.ts, adapter.ts
src/config/index.ts      -- re-exports from schema.ts, loader.ts, defaults.ts
src/errors/result.ts     -- single file, no barrel needed
```

**Rationale:**

- Domain barrels (`src/types/index.ts`) keep imports clean within a domain
- Cross-domain imports use the barrel: `import type { EscalationRequest } from '../types/index.js'`
- No root barrel (`src/index.ts`) to avoid circular dependencies and unused re-exports
- tsup entry point can list specific domain barrels for the build output

### Error Verbosity Decision (Claude's Discretion)

**Recommendation:** Structured error codes with human-readable messages. Include debug context when available but never expose secrets.

```typescript
export interface ConfigError {
  code: 'FILE_NOT_FOUND' | 'INVALID_JSON' | 'VALIDATION_FAILED' | 'MISSING_ENV_VAR';
  message: string; // Human-readable, always present
  details?: unknown; // Zod error, parse error, etc. -- for debug logging
}
```

**Rationale:**

- Error codes enable programmatic handling (switch on `code`)
- Human-readable messages provide immediate context
- Optional `details` field carries structured error data (Zod validation errors, stack traces) for debug logging without cluttering the primary message
- Never include secrets or tokens in error messages

## State of the Art

| Old Approach            | Current Approach                        | When Changed                                      | Impact                                                                                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ESLint `.eslintrc.js`   | ESLint `eslint.config.ts` (flat config) | ESLint 9 (2024), mandatory in ESLint 10 (2026-02) | Flat config is the only supported format in ESLint 10                                            |
| Zod 3.x `message` param | Zod 4.x `error` param                   | Zod 4.0 (2025)                                    | Custom error messages use `error` instead of `message`                                           |
| `ts-node` for dev       | `tsx` for dev                           | 2024+                                             | tsx is ESM-native and esbuild-based; ts-node has poor ESM support                                |
| tsup (esbuild)          | tsdown (Rolldown)                       | 2025-2026                                         | tsup is in maintenance mode; tsdown recommended. But tsdown is pre-1.0. Stick with tsup for now. |
| Jest for testing        | Vitest                                  | 2023+                                             | Vitest is ESM-native, faster, TypeScript-first                                                   |
| `module: "commonjs"`    | `module: "nodenext"`                    | TypeScript 5.x                                    | ESM is the standard for new Node.js projects                                                     |

**Deprecated/outdated:**

- tsup: In maintenance mode, recommends tsdown. Still functional at 8.5.1. Flag for re-evaluation in Phase 7.
- ESLint `.eslintrc.*` format: Not supported in ESLint 10. Use flat config only.
- `SSEServerTransport` (MCP SDK): Deprecated in favor of `StreamableHTTPServerTransport`. Not relevant to Phase 1 but noted for future phases.

## Open Questions

1. **ESLint 10 ecosystem readiness**
   - What we know: typescript-eslint 8.56 officially supports ESLint 10 (`^10.0.0` in peer deps). eslint-config-prettier 10.1.8 supports `>=7.0.0`.
   - What's unclear: Whether all ecosystem tools (IDE integrations, CI runners) have caught up with ESLint 10 in the 12 days since release.
   - Recommendation: Start with ESLint 10. If any tooling issue surfaces, drop to ESLint 9 (same flat config format, just `^9.0.0`). The config is identical.

2. **tsup maintenance status**
   - What we know: tsup 8.5.1 published Nov 2025. README recommends migration to tsdown. tsdown is 0.20.x (pre-1.0).
   - What's unclear: Whether tsup will receive security patches if an esbuild vulnerability is found.
   - Recommendation: Use tsup per requirements. Re-evaluate tsdown maturity in Phase 7 when bundling for distribution becomes critical.

3. **Config file discoverability after plugin installation**
   - What we know: Plugins are cached to `~/.claude/plugins/cache/`. Config file must be inside plugin root.
   - What's unclear: Whether users can easily edit a config file inside the cache directory. A setup command/skill may be needed.
   - Recommendation: Ship a default `escalate.config.json` with sensible defaults. In a future phase, add a setup skill (`/escalate:setup`) that helps users configure. For Phase 1, just define the schema and loader.

## Sources

### Primary (HIGH confidence)

- npm registry -- `npm show` for all package versions, engines, peer dependencies (TypeScript 5.9.3, tsup 8.5.1, zod 4.3.6, vitest 4.0.18, eslint 10.0.0, typescript-eslint 8.56.0, prettier 3.8.1, pnpm 10.30.0, tsdown 0.20.3)
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) -- plugin structure, .mcp.json patterns, CLAUDE_PLUGIN_ROOT, hooks.json format
- [typescript-eslint Shared Configs](https://typescript-eslint.io/users/configs/) -- strictTypeChecked config, flat config examples
- [Zod 4 Release Notes](https://zod.dev/v4) -- API changes from v3, new error parameter, performance improvements
- [Zod 4 API Reference](https://zod.dev/api) -- object schemas, enums, discriminated unions, defaults, safeParse
- [tsconfig/bases node22.json](https://github.com/tsconfig/bases/blob/main/bases/node22.json) -- official TypeScript Node 22 base config

### Secondary (MEDIUM confidence)

- [tsup GitHub README](https://github.com/egoist/tsup) -- maintenance status notice, tsdown migration recommendation
- [tsdown migration guide](https://tsdown.dev/guide/migrate-from-tsup) -- configuration differences, feature gaps
- [TypeScript Result pattern articles](https://hamy.xyz/blog/2025-07_typescript-result-types) -- performance benchmarks (errors-as-values faster than exceptions), community patterns
- [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier) -- flat config integration pattern

### Tertiary (LOW confidence)

- None -- all findings verified through primary or secondary sources.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- all versions verified via npm registry on 2026-02-18
- Architecture: HIGH -- patterns derived from existing project research (ARCHITECTURE.md, STACK.md) and official Claude Code plugin documentation
- Pitfalls: HIGH -- ESM constraints and strict TypeScript flags are well-documented; Zod 4 migration guide is authoritative
- Config schema: HIGH -- Zod 4 API verified against official docs
- Error handling recommendation: MEDIUM -- Result type pattern is well-established but the "no library" recommendation is an opinion call

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (30 days -- stable ecosystem, no fast-moving components)
