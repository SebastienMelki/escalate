/**
 * MCP server with stdio transport for Claude Code integration.
 *
 * Registers escalation tools (create, get, resolve, list) that operate
 * on the shared EscalationStore. The server communicates with Claude Code
 * over stdio -- transport connection happens in the entrypoint, not here.
 *
 * CRITICAL: Never use console.log() in this file. The MCP server uses stdio,
 * so any stdout output corrupts the JSON-RPC protocol. Use console.error()
 * for debug logging if needed.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EscalationStore } from '../state/store.js';

/**
 * Create an MCP server with escalation tools backed by the given store.
 *
 * Returns the McpServer instance. The caller is responsible for connecting
 * it to a transport (e.g., StdioServerTransport).
 */
export function createMcpServer(store: EscalationStore): McpServer {
  const server = new McpServer(
    { name: 'escalate', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Tool 1: Create a pending escalation
  server.registerTool(
    'create_escalation',
    {
      description: 'Create a pending escalation request for a hook event',
      inputSchema: {
        event_type: z.string(),
        title: z.string(),
        question: z.string(),
        urgency: z.enum(['info', 'warning', 'critical']),
        context_json: z.string().optional(),
        fallback_action: z.enum(['allow', 'deny', 'ask-again']).default('deny'),
        timeout_seconds: z.number().default(600),
      },
    },
    (args) => {
      const record = store.create({
        eventType: args.event_type,
        requestJson: JSON.stringify({
          title: args.title,
          question: args.question,
          urgency: args.urgency,
          context_json: args.context_json,
        }),
        fallbackAction: args.fallback_action,
        timeoutSeconds: args.timeout_seconds,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              escalation_id: record.id,
              status: record.status,
            }),
          },
        ],
      };
    },
  );

  // Tool 2: Get an escalation by ID
  server.registerTool(
    'get_escalation',
    {
      description: 'Get the current state of an escalation by its ID',
      inputSchema: {
        escalation_id: z.string(),
      },
    },
    (args) => {
      // Check for timeout first
      store.checkTimeout(args.escalation_id);

      const record = store.getById(args.escalation_id);
      if (!record) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Escalation not found' }),
            },
          ],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(record) }],
      };
    },
  );

  // Tool 3: Resolve a pending escalation
  server.registerTool(
    'resolve_escalation',
    {
      description: 'Resolve a pending escalation with a response',
      inputSchema: {
        escalation_id: z.string(),
        response_json: z.string(),
      },
    },
    (args) => {
      const resolved = store.resolve(args.escalation_id, args.response_json);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: resolved,
              escalation_id: args.escalation_id,
            }),
          },
        ],
      };
    },
  );

  // Tool 4: List all pending escalations
  server.registerTool(
    'list_pending',
    {
      description: 'List all pending escalations',
    },
    () => {
      const pending = store.getPending();

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(pending) }],
      };
    },
  );

  return server;
}
