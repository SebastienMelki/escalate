# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Escalate is a Claude Code plugin. Plugins extend Claude Code with custom skills, agents, hooks, MCP servers, and LSP servers. Plugin components are namespaced under the plugin name (e.g., `/escalate:skill-name`).

## Plugin Directory Structure

```
escalate/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest (name, version, description, etc.)
├── commands/                 # User-invocable slash commands (Markdown files)
├── skills/                   # Agent Skills (each skill is a directory with SKILL.md)
│   └── <skill-name>/
│       └── SKILL.md
├── agents/                   # Custom subagent definitions (Markdown with YAML frontmatter)
├── hooks/
│   └── hooks.json            # Event handlers configuration
├── scripts/                  # Hook and utility scripts
├── .mcp.json                 # MCP server configurations (optional)
├── .lsp.json                 # LSP server configurations (optional)
└── README.md
```

**Critical**: Only `plugin.json` goes inside `.claude-plugin/`. All other directories (`commands/`, `skills/`, `agents/`, `hooks/`) must be at the plugin root.

## Development Commands

### Test plugin locally

```bash
claude --plugin-dir .
```

### Test with other plugins simultaneously

```bash
claude --plugin-dir . --plugin-dir ../other-plugin
```

### Debug plugin loading issues

```bash
claude --debug
```

This shows which plugins are loaded, manifest errors, component registration, and MCP server initialization.

### Validate plugin manifest

Use `/plugin validate` inside Claude Code.

## Plugin Manifest (`plugin.json`)

The `name` field is the only required field. It determines the skill namespace prefix (e.g., `escalate:` for skills). Use kebab-case, no spaces.

Key fields: `name`, `version` (semver), `description`, `author`, `keywords`, `homepage`, `repository`, `license`.

Component paths (`commands`, `agents`, `skills`, `hooks`, `mcpServers`, `lspServers`, `outputStyles`) can override default locations but supplement defaults, not replace them.

## Component Authoring

### Skills (`skills/<name>/SKILL.md`)

- YAML frontmatter between `---` markers defines behavior
- Key frontmatter: `name`, `description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `context`, `agent`
- `$ARGUMENTS` placeholder captures user input; `$ARGUMENTS[N]` or `$N` for positional args
- `!`command`` syntax runs shell commands before skill content is sent (preprocessing)
- `context: fork` runs skill in an isolated subagent context
- Keep SKILL.md under 500 lines; use supporting files for reference material

### Agents (`agents/<name>.md`)

- Markdown files with YAML frontmatter
- Required frontmatter: `name`, `description`
- Optional: `tools`, `disallowedTools`, `model` (sonnet/opus/haiku/inherit), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`
- Agents cannot spawn other subagents

### Hooks (`hooks/hooks.json`)

- Events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `TeammateIdle`, `TaskCompleted`, `PreCompact`, `SessionEnd`
- Hook types: `command` (shell), `prompt` (LLM evaluation), `agent` (multi-turn verification)
- Use `${CLAUDE_PLUGIN_ROOT}` for script paths to ensure portability after installation
- Hook commands receive JSON on stdin; exit 0 = success, exit 2 = blocking error
- Matchers are regex strings filtering by tool name or event-specific fields

### MCP Servers (`.mcp.json`)

- Standard MCP server configuration
- Use `${CLAUDE_PLUGIN_ROOT}` in paths and environment variables

## Key Conventions

- All paths in `plugin.json` must be relative and start with `./`
- Plugin cache: marketplace plugins are copied to `~/.claude/plugins/cache/`; paths cannot traverse outside plugin root (`../` won't work after install)
- Use symlinks for external dependencies if needed
- Version bumps in `plugin.json` are required for installed users to receive updates
- Scripts referenced by hooks must be executable (`chmod +x`)
