export interface UtcExecutionWindow {
  startUtc: string;
  endUtc: string;
}

const utcTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function utcMinuteOfDay(value: string): number {
  if (!utcTimePattern.test(value)) throw new RangeError('UTC time must use HH:mm format');
  const [hours, minutes] = value.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

export function assertUtcExecutionWindow(window: UtcExecutionWindow): void {
  const start = utcMinuteOfDay(window.startUtc);
  const end = utcMinuteOfDay(window.endUtc);
  if (start >= end) throw new RangeError('UTC execution window must not be empty or cross midnight');
}

const atUtcMinute = (date: Date, minute: number, dayOffset = 0): Date =>
  new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + dayOffset,
    Math.floor(minute / 60),
    minute % 60,
  ));

/** Returns the input at an allowed instant, otherwise the next window start. */
export function nextUtcWindowInstant(now: Date, window: UtcExecutionWindow): Date {
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid date');
  assertUtcExecutionWindow(window);
  const startMinute = utcMinuteOfDay(window.startUtc);
  const endMinute = utcMinuteOfDay(window.endUtc);
  const start = atUtcMinute(now, startMinute);
  const end = atUtcMinute(now, endMinute);
  if (now < start) return start;
  if (now < end) return new Date(now);
  return atUtcMinute(now, startMinute, 1);
}

/** Applies global spacing and then normalizes the result into the execution window. */
export function nextCampaignExecutionInstant(
  now: Date,
  window: UtcExecutionWindow,
  minimumSpacingMs: number,
  lastStartedAt?: Date | null,
): Date {
  if (!Number.isSafeInteger(minimumSpacingMs) || minimumSpacingMs < 0 || minimumSpacingMs > 86_400_000) {
    throw new RangeError('minimumSpacingMs must be an integer between 0 and 86400000');
  }
  if (lastStartedAt && !Number.isFinite(lastStartedAt.getTime())) {
    throw new RangeError('lastStartedAt must be a valid date');
  }
  const spacedAt = lastStartedAt
    ? new Date(Math.max(now.getTime(), lastStartedAt.getTime() + minimumSpacingMs))
    : now;
  return nextUtcWindowInstant(spacedAt, window);
}

export function deterministicRetryDelayMs(attempt: number, baseMs: number, maximumMs: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  if (!Number.isSafeInteger(baseMs) || baseMs < 1) throw new RangeError('baseMs must be a positive integer');
  if (!Number.isSafeInteger(maximumMs) || maximumMs < baseMs) {
    throw new RangeError('maximumMs must be a safe integer greater than or equal to baseMs');
  }
  const exponent = attempt - 1;
  if (exponent >= 53 || baseMs > Math.floor(maximumMs / 2 ** exponent)) return maximumMs;
  return Math.min(baseMs * 2 ** exponent, maximumMs);
}

export function canRetryAttempt(attempt: number, maximumAttempts: number): boolean {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new RangeError('maximumAttempts must be a positive integer');
  }
  return attempt < maximumAttempts;
}
