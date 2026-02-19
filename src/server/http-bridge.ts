/**
 * HTTP bridge for hook script communication.
 *
 * Provides a localhost-only HTTP server that hook scripts use to create
 * escalations (POST) and poll for responses (GET). Runs alongside the
 * MCP stdio server in the same Node.js process.
 *
 * Routes:
 *   GET  /health          - Health check
 *   POST /escalations     - Create a pending escalation
 *   GET  /escalations/:id - Get escalation status
 *
 * CRITICAL: Never use console.log() in this file. The MCP server uses stdio,
 * so any stdout output corrupts the JSON-RPC protocol.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { EscalationStore } from '../state/store.js';
import type { FallbackAction } from '../state/types.js';

/** Parse JSON body from an incoming HTTP request. */
function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body.length > 0 ? JSON.parse(body) : undefined);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Send a JSON response with the given status code. */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Create an HTTP bridge server backed by the given escalation store.
 *
 * The server binds to 127.0.0.1 only (no external access).
 * Caller is responsible for calling `.listen()` on the returned server.
 */
export function createHttpBridge(store: EscalationStore): Server {
  /** Handle an incoming HTTP request. */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathParts = url.pathname.split('/').filter(Boolean);

    try {
      // GET /health
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      // POST /escalations
      if (req.method === 'POST' && url.pathname === '/escalations') {
        let body: unknown;
        try {
          body = await parseJsonBody(req);
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body' });
          return;
        }

        if (!body || typeof body !== 'object') {
          sendJson(res, 400, { error: 'Request body must be a JSON object' });
          return;
        }

        const { event_type, request_json, fallback_action, timeout_seconds } = body as {
          event_type?: string;
          request_json?: string;
          fallback_action?: string;
          timeout_seconds?: number;
        };

        if (!event_type || !request_json) {
          sendJson(res, 400, { error: 'event_type and request_json are required' });
          return;
        }

        const record = store.create({
          eventType: event_type,
          requestJson: request_json,
          fallbackAction: (fallback_action ?? 'deny') as FallbackAction,
          timeoutSeconds: timeout_seconds ?? 600,
        });

        sendJson(res, 201, {
          escalation_id: record.id,
          status: record.status,
        });
        return;
      }

      // GET /escalations/:id
      if (req.method === 'GET' && pathParts[0] === 'escalations' && pathParts[1]) {
        const id = pathParts[1];

        // Check for timeout first
        store.checkTimeout(id);

        const record = store.getById(id);
        if (!record) {
          sendJson(res, 404, { error: 'not found' });
          return;
        }

        sendJson(res, 200, record);
        return;
      }

      // All other routes
      sendJson(res, 404, { error: 'not found' });
    } catch (error: unknown) {
      console.error('[escalate] HTTP bridge error:', error);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  return server;
}
