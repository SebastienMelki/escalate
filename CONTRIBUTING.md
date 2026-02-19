# Contributing to Escalate

Thanks for your interest in contributing to Escalate! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/escalate.git
   cd escalate
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Create a branch for your work:
   ```bash
   git checkout -b your-feature-name
   ```

## Development Setup

**Requirements:**
- Node.js >= 22
- pnpm

**Useful commands:**

```bash
pnpm build          # Build with tsup
pnpm test           # Run tests
pnpm test:watch     # Run tests in watch mode
pnpm typecheck      # TypeScript type checking
pnpm lint           # ESLint
pnpm format         # Prettier formatting
pnpm format:check   # Check formatting without writing
```

## Code Standards

- **TypeScript strict mode** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **ESLint** with `@typescript-eslint/strict` -- no `any` types allowed
- **Prettier** for formatting
- **Vitest** for testing -- write tests for new functionality
- **ESM only** -- use `.js` extensions in imports (TypeScript resolves them)
- No `console.log()` in source files -- use `console.error()` for debug output (MCP stdio must stay clean)

## Pull Request Process

1. Make sure all checks pass:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```
2. Write clear, descriptive commit messages
3. Keep PRs focused -- one feature or fix per PR
4. Update tests for any changed behavior
5. Fill out the PR template

## Reporting Issues

Use the GitHub issue templates:
- **Bug Report** -- for something that's broken
- **Feature Request** -- for new functionality ideas

Include reproduction steps for bugs and clear use cases for features.

## Architecture Notes

Escalate follows a layered architecture:

- **Hook scripts** (`scripts/`) are thin dispatchers under 50 lines each. They read stdin, call the HTTP bridge, and write JSON to stdout.
- **Bridge client** (`scripts/lib/bridge-client.ts`) is the shared HTTP layer hook scripts import.
- **HTTP bridge** (`src/server/http-bridge.ts`) accepts hook requests and routes them to the messaging adapter.
- **Messaging adapter** (`src/types/adapter.ts`) is the interface. Slack is the first implementation.
- **State store** (`src/state/`) handles SQLite persistence for pending escalations.

When adding a new messaging platform, implement the `MessagingAdapter` interface -- the rest of the system works through the abstraction.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
