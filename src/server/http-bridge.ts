/**
 * HTTP bridge for hook script communication.
 *
 * Provides a localhost-only HTTP server that hook scripts use to create
 * escalations (POST) and poll for responses (GET). Runs alongside the
 * MCP stdio server in the same Node.js process.
 *
 * Routes:
 *   GET  /health          - Health check
 *   POST /escalations     - Create a pending escalation (intelligence-aware)
 *   GET  /escalations/:id - Get escalation status
 *   POST /summary         - Generate and send session summary
 *
 * When an optional MessagingAdapter is provided, POST /escalations triggers
 * a Slack message via adapter.sendEscalation() (fire-and-forget).
 *
 * Intelligence pipeline (POST /escalations):
 *   1. Re-read config for mid-session tuning
 *   2. Evaluate auto-approval rules
 *   3. Check quiet hours for non-critical events
 *   4. Audit-log every decision
 *   5. Auto-approve/suppress or escalate to Slack
 *
 * CRITICAL: Never use console.log() in this file. The MCP server uses stdio,
 * so any stdout output corrupts the JSON-RPC protocol.
 */
import { join } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { KnownBlock } from '@slack/types';
import type { EscalationStore } from '../state/store.js';
import type { FallbackAction } from '../state/types.js';
import type { MessagingAdapter } from '../types/adapter.js';
import type { EscalationRequest, SuggestedAction } from '../types/escalation.js';
import { evaluateRules, extractFilePaths } from '../intelligence/rules.js';
import { isQuietHours, isCriticalEvent } from '../intelligence/quiet-hours.js';
import { appendAuditEntry } from '../intelligence/audit.js';
import { buildSessionSummary, buildSummaryBlocks } from '../intelligence/summary.js';
import { loadConfig } from '../config/index.js';
import { isOk } from '../errors/result.js';
import type { EscalateConfig } from '../config/schema.js';

/** Options for creating the HTTP bridge. Uses a mutable object so adapter can be set after creation. */
export interface HttpBridgeOptions {
  store: EscalationStore;
  adapter?: MessagingAdapter;
  auditLogPath?: string;
}

/**
 * Build a human-readable question from a hook event type and input data.
 *
 * Each event type produces a contextual question that makes sense in Slack.
 */
function buildQuestionFromEvent(eventType: string, input: Record<string, unknown>): string {
  const rawToolName = input['tool_name'];
  const toolName = typeof rawToolName === 'string' ? rawToolName : 'Unknown';
  const toolInput = JSON.stringify(input['tool_input'] ?? {}).slice(0, 200);
  const lastMessage = input['last_assistant_message'];
  const error = input['error'];

  switch (eventType) {
    case 'PermissionRequest':
      return `Allow ${toolName}? ${toolInput}`;
    case 'PreToolUse':
      return `Allow ${toolName} before execution? ${toolInput}`;
    case 'Stop':
      return `Claude wants to stop. ${typeof lastMessage === 'string' ? lastMessage.slice(0, 200) : 'No context.'}`;
    case 'PostToolUseFailure':
      return `Tool failure: ${toolName} — ${typeof error === 'string' ? error.slice(0, 200) : 'Unknown error'}`;
    default:
      return `Event: ${eventType}`;
  }
}

/**
 * Build suggested action buttons appropriate for the event type.
 *
 * Returns a set of buttons that make sense for the user to click in Slack.
 */
function buildActionsForEvent(eventType: string): SuggestedAction[] {
  switch (eventType) {
    case 'PermissionRequest':
    case 'PreToolUse':
      return [
        { id: 'approve', label: 'Approve', style: 'primary' },
        { id: 'deny', label: 'Deny', style: 'danger' },
        { id: 'snooze', label: 'Snooze' },
      ];
    case 'Stop':
      return [
        { id: 'stop', label: 'Stop', style: 'danger' },
        { id: 'continue', label: 'Continue', style: 'primary' },
      ];
    case 'PostToolUseFailure':
      return [{ id: 'acknowledge', label: 'Acknowledged' }];
    default:
      return [
        { id: 'approve', label: 'Approve', style: 'primary' },
        { id: 'deny', label: 'Deny', style: 'danger' },
      ];
  }
}

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

/** Default audit log path based on project directory. */
function defaultAuditLogPath(): string {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  return join(projectDir, '.claude', 'escalate-audit.jsonl');
}

/**
 * Create an HTTP bridge server backed by the given escalation store.
 *
 * The server binds to 127.0.0.1 only (no external access).
 * Caller is responsible for calling `.listen()` on the returned server.
 *
 * The options object is mutable: `options.adapter` can be set after creation
 * and the request handler will pick it up at request time (not creation time).
 */
export function createHttpBridge(options: HttpBridgeOptions): Server {
  const { store } = options;

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

      // POST /escalations — intelligence-aware escalation pipeline
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

        // Parse hook input for intelligence evaluation
        const hookInput = JSON.parse(request_json) as Record<string, unknown>;
        const toolName = hookInput['tool_name'] as string | undefined;
        const filePaths = extractFilePaths(toolName, (hookInput['tool_input'] ?? {}) as Record<string, unknown>);

        // Re-read config on every request for mid-session rule tuning
        let config: EscalateConfig | undefined;
        const configResult = loadConfig();
        if (isOk(configResult)) {
          config = configResult.data;
        }

        // Intelligence evaluation: determine whether to escalate, auto-approve, or suppress
        let decision: 'escalate' | 'auto_approve' | 'quiet_hours_suppress' = 'escalate';
        let reason = 'No config available, defaulting to escalate';
        let matchedRuleDescription: string | undefined;

        if (config) {
          // Get escalation policy for event type (bracket notation for noPropertyAccessFromIndexSignature)
          const policyMap: Record<string, string> = {
            PermissionRequest: config.escalationPolicies.permissionRequest,
            PreToolUse: config.escalationPolicies.preToolUse,
            Stop: config.escalationPolicies.stop,
            PostToolUseFailure: config.escalationPolicies.postToolUseFailure,
          };
          const policy = (policyMap[event_type] ?? 'always') as 'always' | 'conditional' | 'never';

          // Evaluate auto-approval rules
          const ruleResult = evaluateRules(
            { eventType: event_type, ...(toolName !== undefined ? { toolName } : {}), filePaths },
            config.autoApprovalRules,
            policy,
          );
          decision = ruleResult.decision;
          reason = ruleResult.reason;
          matchedRuleDescription = ruleResult.matchedRule?.description;

          // Check quiet hours for non-critical events that would be escalated
          if (
            decision === 'escalate' &&
            isQuietHours(config.quietHours) &&
            !isCriticalEvent(event_type, config.quietHours.criticalEvents)
          ) {
            decision = 'quiet_hours_suppress';
            reason = 'Suppressed during quiet hours';
          }
        }

        // Audit log every decision (respects auditLog.enabled config, defaults to true)
        if (config?.auditLog.enabled ?? true) {
          const auditLogPath = options.auditLogPath ?? defaultAuditLogPath();
          try {
            appendAuditEntry(auditLogPath, {
              timestamp: new Date().toISOString(),
              eventType: event_type,
              decision: decision === 'escalate' ? 'escalated' : decision === 'auto_approve' ? 'auto_approved' : 'quiet_hours_suppressed',
              reason,
              ...(toolName !== undefined ? { toolName } : {}),
              ...(filePaths.length > 0 ? { filePaths } : {}),
              ...(matchedRuleDescription !== undefined ? { matchedRule: matchedRuleDescription } : {}),
            });
          } catch (auditErr: unknown) {
            console.error('[escalate] Audit log write failed (non-blocking):', auditErr);
          }
        }

        // Auto-approved or quiet-hours-suppressed: create pre-resolved record, skip Slack
        if (decision === 'auto_approve' || decision === 'quiet_hours_suppress') {
          // Determine response action based on fallback policy
          let responseAction = 'approve';
          if (decision === 'quiet_hours_suppress' && config) {
            const fallbackMap: Record<string, string> = {
              PermissionRequest: config.fallbackActions.permissionRequest,
              PreToolUse: config.fallbackActions.preToolUse,
              Stop: config.fallbackActions.stop,
              PostToolUseFailure: config.fallbackActions.postToolUseFailure,
            };
            const fallback = fallbackMap[event_type] ?? 'allow';
            // Map fallback actions to response actions
            if (fallback === 'deny') {
              responseAction = 'deny';
            } else {
              // 'allow' and 'ask-again' both map to 'approve' (user not available during quiet hours)
              responseAction = 'approve';
            }
          }

          const record = store.create({
            eventType: event_type,
            requestJson: request_json,
            fallbackAction: (fallback_action ?? 'deny') as FallbackAction,
            timeoutSeconds: timeout_seconds ?? 600,
          });
          store.resolve(record.id, JSON.stringify({ type: 'action', actionId: responseAction }));
          sendJson(res, 201, { escalation_id: record.id, status: 'resolved' });
          return;
        }

        // Decision is 'escalate': proceed with existing flow
        const record = store.create({
          eventType: event_type,
          requestJson: request_json,
          fallbackAction: (fallback_action ?? 'deny') as FallbackAction,
          timeoutSeconds: timeout_seconds ?? 600,
        });

        // Fire-and-forget Slack notification when adapter is available
        const adapter = options.adapter;
        if (adapter?.isConnected()) {
          const context: EscalationRequest['context'] = {
            eventType: event_type,
            ...(typeof toolName === 'string' ? { toolName } : {}),
            ...(filePaths.length > 0 ? { filePaths } : {}),
          };
          const escalationRequest: EscalationRequest = {
            id: record.id,
            title: `${event_type}: ${toolName ?? 'Unknown'}`,
            question: buildQuestionFromEvent(event_type, hookInput),
            urgency: event_type === 'PostToolUseFailure' ? 'warning' : 'critical',
            context,
            suggestedActions: buildActionsForEvent(event_type),
            allowFreeformResponse: true,
          };
          void adapter.sendEscalation(escalationRequest).catch((err: unknown) => {
            console.error('[escalate] Failed to send Slack escalation:', err);
          });
        }

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

      // POST /summary — session summary dispatch
      if (req.method === 'POST' && url.pathname === '/summary') {
        const auditLogPath = options.auditLogPath ?? defaultAuditLogPath();
        const summary = buildSessionSummary(auditLogPath);
        const blocks = buildSummaryBlocks(summary);

        // Type-narrow adapter to check for Slack-specific sendSummary method
        const adapter = options.adapter;
        if (adapter && adapter.isConnected() && 'sendSummary' in adapter) {
          try {
            await (adapter as { sendSummary: (blocks: KnownBlock[]) => Promise<void> }).sendSummary(blocks);
            sendJson(res, 200, { status: 'sent', summary });
          } catch (summaryErr: unknown) {
            console.error('[escalate] Failed to send summary:', summaryErr);
            sendJson(res, 200, { status: 'error', summary });
          }
        } else {
          sendJson(res, 200, { status: 'no_adapter', summary });
        }
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
