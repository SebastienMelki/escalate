/**
 * Server entrypoint: wires MCP server + HTTP bridge + SQLite state store.
 *
 * This is the main process started by Claude Code as an MCP server plugin.
 * It creates a shared SQLite database, starts the MCP server on stdio,
 * and starts the HTTP bridge on a dynamic port for hook script communication.
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
import { createHttpBridge } from './http-bridge.js';

/** Server state for clean shutdown. */
let httpServer: Server | undefined;
let db: Database.Database | undefined;

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

  // Create and start HTTP bridge
  httpServer = createHttpBridge(store);

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

  // Connect MCP server to stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

/** Stop the server and clean up resources. */
export async function stopServer(): Promise<void> {
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
