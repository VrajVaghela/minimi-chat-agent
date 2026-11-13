/**
 * Calendar math in a named timezone.
 *
 * Timestamps are stored as UTC epoch milliseconds. "Monday" and "3 November"
 * are calendar days in the user's zone (default Asia/Kolkata), so the
 * conversion has to happen here and not in the model.
 */

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Some engines report midnight as 24.
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** UTC epoch for a wall-clock time in `timeZone`. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (utc: number) => {
    const parts = zonedParts(utc, timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    return asUtc - utc;
  };
  // One correction pass covers DST, where the offset at the guess differs
  // from the offset at the real instant.
  const first = guess - offsetAt(guess);
  const secondPass = guess - offsetAt(first);
  return secondPass;
}

export function startOfZonedDay(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

export function addZonedDays(ms: number, days: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return zonedTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
    timeZone,
  );
}

/** Monday 00:00 of the ISO week that contains `ms`. */
export function startOfIsoWeek(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const fromMonday = parts.weekday === 0 ? 6 : parts.weekday - 1;
  return addZonedDays(startOfZonedDay(ms, timeZone), -fromMonday, timeZone);
}

export function formatDayLabel(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ms));
}

export function formatStamp(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

export function dayWindow(startMs: number, timeZone: string): { startMs: number; endMs: number; label: string } {
  return {
    startMs,
    endMs: addZonedDays(startMs, 1, timeZone),
    label: formatDayLabel(startMs, timeZone),
  };
}
