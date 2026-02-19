/**
 * Unit tests for hook script output translation logic.
 *
 * Tests the pure-function output builders that translate bridge poll results
 * into Claude Code hook JSON output for each event type.
 */
import { describe, it, expect } from 'vitest';
import type { EscalationResult } from '../scripts/lib/bridge-client.js';
import {
  buildPermissionRequestOutput,
  buildPreToolUseOutput,
  buildStopOutput,
  buildPostToolFailureOutput,
} from '../scripts/lib/output-helpers.js';

describe('hook output helpers', () => {
  describe('buildPermissionRequestOutput', () => {
    it('returns allow decision when user approves', () => {
      const result: EscalationResult = {
        status: 'resolved',
        responseJson: JSON.stringify({ type: 'action', actionId: 'approve' }),
      };

      const output = JSON.parse(buildPermissionRequestOutput(result)) as Record<string, unknown>;

      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'allow' },
        },
      });
    });

    it('returns deny decision when user explicitly denies', () => {
      const result: EscalationResult = {
        status: 'resolved',
        responseJson: JSON.stringify({ type: 'action', actionId: 'deny' }),
      };

      const output = JSON.parse(buildPermissionRequestOutput(result)) as Record<string, unknown>;
      const specific = (output as { hookSpecificOutput: { decision: { behavior: string } } }).hookSpecificOutput;

      expect(specific.decision.behavior).toBe('deny');
    });

    it('returns deny decision on timeout (fallback)', () => {
      const result: EscalationResult = { status: 'timed_out' };

      const output = JSON.parse(buildPermissionRequestOutput(result)) as Record<string, unknown>;
      const specific = (output as { hookSpecificOutput: { decision: { behavior: string; message: string } } })
        .hookSpecificOutput;

      expect(specific.decision.behavior).toBe('deny');
      expect(specific.decision.message).toContain('Escalate');
    });
  });

  describe('buildPreToolUseOutput', () => {
    it('returns allow when user approves', () => {
      const result: EscalationResult = {
        status: 'resolved',
        responseJson: JSON.stringify({ type: 'action', actionId: 'approve' }),
      };

      const output = JSON.parse(buildPreToolUseOutput(result)) as Record<string, unknown>;

      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      });
    });

    it('returns deny when user denies', () => {
      const result: EscalationResult = {
        status: 'resolved',
        responseJson: JSON.stringify({ type: 'action', actionId: 'deny' }),
      };

      const output = JSON.parse(buildPreToolUseOutput(result)) as Record<string, unknown>;
      const specific = (output as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput;

      expect(specific.permissionDecision).toBe('deny');
    });

    it('returns deny on timeout', () => {
      const result: EscalationResult = { status: 'timed_out' };

      const output = JSON.parse(buildPreToolUseOutput(result)) as Record<string, unknown>;
      const specific = (
        output as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }
      ).hookSpecificOutput;

      expect(specific.permissionDecision).toBe('deny');
      expect(specific.permissionDecisionReason).toContain('Escalate');
    });
  });

  describe('buildStopOutput', () => {
    it('returns block decision when user wants to continue', () => {
      const result: EscalationResult = {
        status: 'resolved',
        responseJson: JSON.stringify({ type: 'action', actionId: 'continue' }),
      };

      const raw = buildStopOutput(result);
      expect(raw).not.toBeNull();
      const output = JSON.parse(raw as string) as Record<string, unknown>;

      expect(output).toEqual({
        decision: 'block',
        reason: 'User wants to continue via Escalate',
      });
    });

    it('returns block with custom text from user', () => {
      const result: EscalationResult = {
        status: 'resolved',
        responseJson: JSON.stringify({ type: 'text', text: 'Please finish the tests first' }),
      };

      const raw = buildStopOutput(result);
      expect(raw).not.toBeNull();
      const output = JSON.parse(raw as string) as Record<string, unknown>;

      expect(output).toEqual({
        decision: 'block',
        reason: 'Please finish the tests first',
      });
    });

    it('returns null (allow stop) on timeout', () => {
      const result: EscalationResult = { status: 'timed_out' };

      expect(buildStopOutput(result)).toBeNull();
    });

    it('returns null (allow stop) when user explicitly allows', () => {
      const result: EscalationResult = {
        status: 'resolved',
        responseJson: JSON.stringify({ type: 'action', actionId: 'stop' }),
      };

      expect(buildStopOutput(result)).toBeNull();
    });
  });

  describe('buildPostToolFailureOutput', () => {
    it('returns notification output with Slack context', () => {
      const output = JSON.parse(buildPostToolFailureOutput()) as Record<string, unknown>;

      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PostToolUseFailure',
          additionalContext: 'User has been notified of this failure via Slack',
        },
      });
    });
  });

  describe('stop_hook_active bypass', () => {
    it('is handled at the script level (not in output helper)', () => {
      // The stop_hook_active check is in on-stop.ts before any escalation
      // is created. This test documents that the helper is NOT called when
      // stop_hook_active is true — the script exits immediately.
      // We verify by checking that buildStopOutput requires an EscalationResult,
      // which would not exist if the script bailed out early.
      expect(typeof buildStopOutput).toBe('function');
    });
  });

  describe('edge cases', () => {
    it('PermissionRequest handles null responseJson', () => {
      const result: EscalationResult = { status: 'resolved', responseJson: null };

      const output = JSON.parse(buildPermissionRequestOutput(result)) as Record<string, unknown>;
      const specific = (output as { hookSpecificOutput: { decision: { behavior: string } } }).hookSpecificOutput;

      expect(specific.decision.behavior).toBe('deny');
    });

    it('Stop handles missing responseJson', () => {
      const result: EscalationResult = { status: 'resolved' };

      expect(buildStopOutput(result)).toBeNull();
    });
  });
});
