import { describe, it, expect } from 'vitest';
import {
  EscalateConfigSchema,
  UrgencyLevelSchema,
  EscalationPolicySchema,
} from '../../src/config/schema.js';

describe('UrgencyLevelSchema', () => {
  it('accepts valid urgency levels', () => {
    expect(UrgencyLevelSchema.safeParse('info').success).toBe(true);
    expect(UrgencyLevelSchema.safeParse('warning').success).toBe(true);
    expect(UrgencyLevelSchema.safeParse('critical').success).toBe(true);
  });

  it('rejects invalid urgency level', () => {
    const result = UrgencyLevelSchema.safeParse('high');
    expect(result.success).toBe(false);
  });
});

describe('EscalationPolicySchema', () => {
  it('accepts valid escalation policies', () => {
    expect(EscalationPolicySchema.safeParse('always').success).toBe(true);
    expect(EscalationPolicySchema.safeParse('conditional').success).toBe(true);
    expect(EscalationPolicySchema.safeParse('never').success).toBe(true);
  });

  it('rejects invalid escalation policy', () => {
    const result = EscalationPolicySchema.safeParse('maybe');
    expect(result.success).toBe(false);
  });
});

describe('EscalateConfigSchema', () => {
  it('parses valid minimal config with defaults applied', () => {
    const input = {
      slack: { channelId: 'C0123456789' },
    };

    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      // Defaults should be applied
      expect(result.data.timeouts.permissionRequest).toBe(600_000);
      expect(result.data.timeouts.preToolUse).toBe(300_000);
      expect(result.data.timeouts.stop).toBe(600_000);
      expect(result.data.timeouts.postToolUseFailure).toBe(60_000);

      expect(result.data.escalationPolicies.permissionRequest).toBe('always');
      expect(result.data.escalationPolicies.preToolUse).toBe('conditional');
      expect(result.data.escalationPolicies.stop).toBe('always');
      expect(result.data.escalationPolicies.postToolUseFailure).toBe('always');
    }
  });

  it('parses valid full config with all fields explicit', () => {
    const input = {
      slack: { channelId: 'C0123456789' },
      timeouts: {
        permissionRequest: 120_000,
        preToolUse: 60_000,
        stop: 120_000,
        postToolUseFailure: 30_000,
      },
      escalationPolicies: {
        permissionRequest: 'never',
        preToolUse: 'always',
        stop: 'conditional',
        postToolUseFailure: 'never',
      },
    };

    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeouts.permissionRequest).toBe(120_000);
      expect(result.data.timeouts.preToolUse).toBe(60_000);
      expect(result.data.timeouts.stop).toBe(120_000);
      expect(result.data.timeouts.postToolUseFailure).toBe(30_000);

      expect(result.data.escalationPolicies.permissionRequest).toBe('never');
      expect(result.data.escalationPolicies.preToolUse).toBe('always');
      expect(result.data.escalationPolicies.stop).toBe('conditional');
      expect(result.data.escalationPolicies.postToolUseFailure).toBe('never');
    }
  });

  it('rejects missing slack.channelId (required field)', () => {
    const input = {};
    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects empty channelId string', () => {
    const input = { slack: { channelId: '' } };
    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid urgency level in config context', () => {
    const input = {
      slack: { channelId: 'C0123456789' },
      escalationPolicies: {
        permissionRequest: 'high' as const,
      },
    };
    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid escalation policy in config context', () => {
    const input = {
      slack: { channelId: 'C0123456789' },
      escalationPolicies: {
        permissionRequest: 'maybe' as const,
      },
    };
    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects timeout of 0', () => {
    const input = {
      slack: { channelId: 'C0123456789' },
      timeouts: { permissionRequest: 0 },
    };
    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const input = {
      slack: { channelId: 'C0123456789' },
      timeouts: { permissionRequest: -1 },
    };
    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('handles extra unknown fields', () => {
    const input = {
      slack: { channelId: 'C0123456789' },
      extraField: 'should be stripped or ignored',
    };
    // Zod 4 strips unknown keys by default on objects
    const result = EscalateConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extraField');
    }
  });
});
