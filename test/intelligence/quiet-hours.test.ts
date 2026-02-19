import { describe, it, expect } from 'vitest';
import {
  isQuietHours,
  isCriticalEvent,
} from '../../src/intelligence/quiet-hours.js';
import type { QuietHoursConfig } from '../../src/intelligence/quiet-hours.js';

describe('isQuietHours', () => {
  const overnightConfig: QuietHoursConfig = {
    enabled: true,
    start: '22:00',
    end: '07:00',
    timezone: 'UTC',
    criticalEvents: ['PermissionRequest', 'Stop'],
  };

  const sameDayConfig: QuietHoursConfig = {
    enabled: true,
    start: '13:00',
    end: '15:00',
    timezone: 'UTC',
    criticalEvents: ['PermissionRequest', 'Stop'],
  };

  it('returns false when disabled', () => {
    const config: QuietHoursConfig = { ...overnightConfig, enabled: false };
    // 23:00 UTC would be quiet if enabled
    const now = new Date('2026-01-15T23:00:00Z');
    expect(isQuietHours(config, now)).toBe(false);
  });

  it('returns true at 23:00 with range 22:00-07:00 (overnight)', () => {
    const now = new Date('2026-01-15T23:00:00Z');
    expect(isQuietHours(overnightConfig, now)).toBe(true);
  });

  it('returns true at 02:00 with range 22:00-07:00 (overnight, past midnight)', () => {
    const now = new Date('2026-01-16T02:00:00Z');
    expect(isQuietHours(overnightConfig, now)).toBe(true);
  });

  it('returns false at 12:00 with range 22:00-07:00', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(isQuietHours(overnightConfig, now)).toBe(false);
  });

  it('returns true at 14:00 with range 13:00-15:00 (same-day range)', () => {
    const now = new Date('2026-01-15T14:00:00Z');
    expect(isQuietHours(sameDayConfig, now)).toBe(true);
  });

  it('returns false at 16:00 with range 13:00-15:00', () => {
    const now = new Date('2026-01-15T16:00:00Z');
    expect(isQuietHours(sameDayConfig, now)).toBe(false);
  });

  it('respects timezone parameter with injected now', () => {
    // 2026-01-15T23:00:00Z = 2026-01-16T08:00:00+09:00 in Asia/Tokyo
    // With range 22:00-07:00 in Asia/Tokyo, 08:00 is OUTSIDE quiet hours
    const tokyoConfig: QuietHoursConfig = {
      ...overnightConfig,
      timezone: 'Asia/Tokyo',
    };
    const now = new Date('2026-01-15T23:00:00Z');
    expect(isQuietHours(tokyoConfig, now)).toBe(false);
  });

  it('returns true at boundary start time', () => {
    const now = new Date('2026-01-15T22:00:00Z');
    expect(isQuietHours(overnightConfig, now)).toBe(true);
  });

  it('returns false at boundary end time', () => {
    const now = new Date('2026-01-16T07:00:00Z');
    expect(isQuietHours(overnightConfig, now)).toBe(false);
  });
});

describe('isCriticalEvent', () => {
  const criticalEvents = ['PermissionRequest', 'Stop'];

  it('returns true for PermissionRequest', () => {
    expect(isCriticalEvent('PermissionRequest', criticalEvents)).toBe(true);
  });

  it('returns true for Stop', () => {
    expect(isCriticalEvent('Stop', criticalEvents)).toBe(true);
  });

  it('returns false for PreToolUse', () => {
    expect(isCriticalEvent('PreToolUse', criticalEvents)).toBe(false);
  });

  it('returns false for PostToolUseFailure', () => {
    expect(isCriticalEvent('PostToolUseFailure', criticalEvents)).toBe(false);
  });
});
