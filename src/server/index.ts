/**
 * Server entrypoint: wires MCP server + HTTP bridge + Slack adapter + SQLite state store.
 *
 * This is the main process started by Claude Code as an MCP server plugin.
 * It creates a shared SQLite database, starts the MCP server on stdio,
 * starts the HTTP bridge on a dynamic port for hook script communication,
 * and optionally connects the Slack adapter for phone escalations.
 *
 * CRITICAL: Never use console.log() in this file. The MCP server uses stdio,
 * so any stdout output corrupts the JSON-RPC protocol.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { EscalationStore } from '../state/store.js';
import { createMcpServer } from './mcp-server.js';
import { createHttpBridge, type HttpBridgeOptions } from './http-bridge.js';
import { SlackAdapter } from '../slack/adapter.js';
import { loadConfig, loadSecrets } from '../config/index.js';
import { isOk } from '../errors/result.js';

/** Server state for clean shutdown. */
let httpServer: Server | undefined;
let db: Database.Database | undefined;
let slackAdapter: SlackAdapter | undefined;

/** Options for starting the server. */
export interface StartServerOptions {
  /** Port for the HTTP bridge. Defaults to 0 (dynamic). */
  port?: number;
  /** Path to the SQLite database file. */
  dbPath?: string;
}

/**
 * Start the MCP server and HTTP bridge.
 *
 * 1. Opens SQLite database at the configured path
 * 2. Creates EscalationStore with the database
 * 3. Starts MCP server with stdio transport
 * 4. Starts HTTP bridge on localhost
 * 5. Writes port file for hook script discovery
 */
export async function startServer(options?: StartServerOptions): Promise<void> {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const dbPath = options?.dbPath ?? join(projectDir, '.claude', 'escalate.db');

  // Ensure the database directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  // Open SQLite database
  db = new Database(dbPath);

  // Create state store
  const store = new EscalationStore(db);

  // Create MCP server
  const mcpServer = createMcpServer(store);

  // Create HTTP bridge with mutable options (adapter set after Slack init)
  const auditLogPath = join(projectDir, '.claude', 'escalate-audit.jsonl');
  const bridgeOptions: HttpBridgeOptions = { store, auditLogPath };
  httpServer = createHttpBridge(bridgeOptions);

  await new Promise<void>((resolve) => {
    httpServer?.listen(options?.port ?? 0, '127.0.0.1', () => {
      const addr = httpServer?.address();
      if (addr && typeof addr === 'object') {
        const port = String(addr.port);

        // Write port file for hook script discovery
        const portFilePath = join(projectDir, '.claude', 'escalate-port');
        mkdirSync(dirname(portFilePath), { recursive: true });
        writeFileSync(portFilePath, port, 'utf-8');

        console.error(`[escalate] MCP server started, HTTP bridge on port ${port}`);
      }
      resolve();
    });
  });

  // Start Slack adapter (optional -- does not crash MCP server on failure)
  const configResult = loadConfig();
  const secretsResult = loadSecrets();

  if (isOk(configResult) && isOk(secretsResult)) {
    const config = configResult.data;
    const secrets = secretsResult.data;

    slackAdapter = new SlackAdapter({
      botToken: secrets.slackBotToken,
      appToken: secrets.slackAppToken,
      channelId: config.slack.channelId,
      store,
      config,
    });

    try {
      await slackAdapter.start();
      await slackAdapter.validateAndAnnounce();

      // Wire Slack adapter into HTTP bridge for escalation dispatch
      bridgeOptions.adapter = slackAdapter;
    } catch (error: unknown) {
      console.error('[escalate] Slack adapter failed to start:', error);
      // Don't crash the MCP server -- Slack is optional
      // Log the error but continue with MCP + HTTP bridge
      slackAdapter = undefined;
    }
  } else {
    console.error('[escalate] Slack adapter not started: missing config or secrets');
    if (!isOk(configResult)) {
      console.error('[escalate] Config error:', configResult.error.message);
    }
    if (!isOk(secretsResult)) {
      console.error('[escalate] Secrets error:', secretsResult.error.message);
    }
  }

  // Connect MCP server to stdio transport (blocks on stdio -- must be last)
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

/** Stop the server and clean up resources. */
export async function stopServer(): Promise<void> {
  // Stop Slack adapter first (best-effort)
  if (slackAdapter) {
    try {
      await slackAdapter.stop();
    } catch {
      // Best-effort cleanup
    }
    slackAdapter = undefined;
  }

  if (httpServer) {
    await new Promise<void>((resolve, reject) => {
      httpServer?.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    httpServer = undefined;
  }

  if (db) {
    db.close();
    db = undefined;
  }
}

/**
 * Auto-start when this file is the main entry point.
 *
 * Checks if this module is being run directly (node dist/server/index.js)
 * vs imported as a library (import { startServer } from 'escalate').
 * Uses fileURLToPath to compare import.meta.url with process.argv[1].
 */
const isMainModule = (() => {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const entryFile = process.argv[1];
    return entryFile !== undefined && currentFile === entryFile;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const handleShutdown = (): void => {
    void stopServer().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  startServer().catch((error: unknown) => {
    console.error('[escalate] Failed to start server:', error);
    process.exit(1);
  });
}
