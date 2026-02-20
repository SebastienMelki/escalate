/**
 * MCP server entry point — always starts the server.
 *
 * This is a thin wrapper that Claude Code invokes via .mcp.json.
 * It exists separately from index.ts because tsup code-splitting
 * moves the isMainModule detection into a chunk file where it fails.
 */
import { startServer, stopServer } from './index.js';

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
