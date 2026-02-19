/**
 * Quiet hours evaluation for escalation suppression.
 *
 * Pure functions that determine whether the current time falls within
 * configured quiet hours, with timezone support and critical event bypass.
 */

/** Configuration for quiet hours. */
export interface QuietHoursConfig {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly criticalEvents: readonly string[];
}

/**
 * Parse an "HH:MM" time string to minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const parts = time.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  return hours * 60 + minutes;
}

/**
 * Get the current hour and minute in the given timezone.
 */
function getCurrentMinutes(timezone: string, now: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let hour = 0;
  let minute = 0;

  for (const part of parts) {
    if (part.type === 'hour') {
      hour = Number(part.value);
    } else if (part.type === 'minute') {
      minute = Number(part.value);
    }
  }

  return hour * 60 + minute;
}

/**
 * Check whether the current time falls within quiet hours.
 *
 * Handles both same-day ranges (13:00-15:00) and overnight ranges
 * (22:00-07:00). Overnight ranges wrap past midnight: current time
 * is quiet if it is >= start OR < end.
 *
 * @param config - Quiet hours configuration
 * @param now - Optional Date for deterministic testing (defaults to current time)
 * @returns true if currently in quiet hours
 */
export function isQuietHours(config: QuietHoursConfig, now?: Date): boolean {
  if (!config.enabled) {
    return false;
  }

  const currentMinutes = getCurrentMinutes(config.timezone, now ?? new Date());
  const startMinutes = parseTimeToMinutes(config.start);
  const endMinutes = parseTimeToMinutes(config.end);

  if (startMinutes <= endMinutes) {
    // Same-day range (e.g. 13:00-15:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Overnight range (e.g. 22:00-07:00): current >= start OR current < end
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Check whether an event type is considered critical.
 *
 * Critical events bypass quiet hours suppression and are always escalated.
 */
export function isCriticalEvent(
  eventType: string,
  criticalEvents: readonly string[],
): boolean {
  return criticalEvents.includes(eventType);
}
