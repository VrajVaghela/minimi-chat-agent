/**
 * Resolve the dates a person actually says.
 *
 * Policy, fixed so it can be tested and explained:
 *
 * - Bare weekday, or "on Monday": the most recent occurrence, including today.
 * - "last Tuesday": the most recent past Tuesday, not including today.
 *   If that day is still inside the current week, also record the Tuesday
 *   before it. "Last Tuesday" is genuinely ambiguous, and an empty day should
 *   not hide a real conversation seven days earlier. The answer says which
 *   reading it used.
 * - "this Tuesday": that weekday in the current ISO week (Monday–Sunday),
 *   even if it is still ahead of us.
 * - "past Tuesday" / "this past Tuesday": the most recent past one, no alternate.
 * - "next Tuesday": the next one strictly after today.
 * - "3 November" with no year: this year, unless that day is still in the
 *   future, in which case last year. Recall questions look backward.
 * - "3/11/2026" is day-first (the team is in Bengaluru). If only the
 *   month-first reading is a real date, that one is used. If both are real,
 *   day-first is primary and month-first is the alternate.
 * - "since Monday" is that day, and also the start of a freshness window.
 * - "since then" and a trailing "since" point at the other date in the message.
 */

import {
  addZonedDays,
  dayWindow,
  startOfIsoWeek,
  startOfZonedDay,
  zonedParts,
  zonedTimeToUtc,
} from "./clock";
import type { ResolvedMention } from "./types";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const FULL_MONTHS = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

const MONTH_PATTERN = Object.keys(MONTHS).join("|");
const WEEKDAY_PATTERN = Object.keys(WEEKDAYS).join("|");

type Built = Omit<ResolvedMention, "phrase" | "index">;

function monthNumber(raw: string): number | null {
  const lower = raw.toLowerCase();
  const num = MONTHS[lower];
  if (!num) return null;
  // "may" and "nov" are also ordinary words. Full month names of 4+ letters
  // are accepted in any case; short tokens must be capitalized ("3 Nov", "May").
  if (FULL_MONTHS.has(lower) && lower !== "may") return num;
  return raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase() ? num : null;
}

function calendarDay(
  year: number,
  month: number,
  day: number,
  now: number,
  timeZone: string,
  yearWasExplicit: boolean,
): { startMs: number; endMs: number; label: string } | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let y = year;
  const build = (yearNum: number) => {
    const startMs = zonedTimeToUtc(yearNum, month, day, 0, 0, 0, timeZone);
    const parts = zonedParts(startMs, timeZone);
    if (parts.year !== yearNum || parts.month !== month || parts.day !== day) return null;
    return dayWindow(startMs, timeZone);
  };
  let window = build(y);
  if (!window) return null;
  if (!yearWasExplicit && window.startMs > startOfZonedDay(now, timeZone)) {
    y -= 1;
    window = build(y);
  }
  return window;
}

function resolveWeekday(modifier: string | undefined, weekdayName: string, now: number, timeZone: string): Built {
  const target = WEEKDAYS[weekdayName.toLowerCase()];
  const today = zonedParts(now, timeZone);
  const todayStart = startOfZonedDay(now, timeZone);
  const back = (today.weekday - target + 7) % 7;
  const mod = (modifier ?? "bare").toLowerCase();

  const asDay = (startMs: number) => dayWindow(startMs, timeZone);

  if (mod === "next") {
    const ahead = back === 0 ? 7 : 7 - back;
    const window = asDay(addZonedDays(todayStart, ahead, timeZone));
    return { kind: "day", since: false, ...window, alternates: [] };
  }

  if (mod === "this") {
    const weekStart = startOfIsoWeek(now, timeZone);
    const offset = target === 0 ? 6 : target - 1;
    const window = asDay(addZonedDays(weekStart, offset, timeZone));
    return { kind: "day", since: false, ...window, alternates: [] };
  }

  if (mod === "past" || mod === "this past") {
    const primaryBack = back === 0 ? 7 : back;
    const window = asDay(addZonedDays(todayStart, -primaryBack, timeZone));
    return { kind: "day", since: false, ...window, alternates: [] };
  }

  if (mod === "last") {
    const primaryBack = back === 0 ? 7 : back;
    const startMs = addZonedDays(todayStart, -primaryBack, timeZone);
    const window = asDay(startMs);
    const weekStart = startOfIsoWeek(now, timeZone);
    const alternates = [];
    // Only offer the previous week when the primary reading is still "this week".
    if (startMs >= weekStart) {
      alternates.push(asDay(addZonedDays(startMs, -7, timeZone)));
    }
    return { kind: "day", since: false, ...window, alternates };
  }

  const window = asDay(addZonedDays(todayStart, -back, timeZone));
  return { kind: "day", since: false, ...window, alternates: [] };
}

function precededBySince(text: string, index: number): boolean {
  return /\bsince\s+$/i.test(text.slice(Math.max(0, index - 16), index));
}

type Candidate = {
  index: number;
  length: number;
  phrase: string;
  build: () => Built | null;
};

export function resolveMentions(text: string, now: number, timeZone: string): ResolvedMention[] {
  const candidates: Candidate[] = [];
  const todayStart = startOfZonedDay(now, timeZone);

  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const phrase = match[0];
    const index = match.index ?? 0;
    candidates.push({
      index,
      length: phrase.length,
      phrase,
      build: () => {
        const window = calendarDay(
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
          now,
          timeZone,
          true,
        );
        return window ? { kind: "day", since: false, ...window, alternates: [] } : null;
      },
    });
  }

  for (const match of text.matchAll(/\bsince\s+then\b/gi)) {
    const phrase = match[0];
    const index = match.index ?? 0;
    candidates.push({
      index,
      length: phrase.length,
      phrase,
      build: () => ({
        kind: "since-then",
        since: true,
        startMs: 0,
        endMs: 0,
        label: "then",
        alternates: [],
      }),
    });
  }

  const dayMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?\\b`,
    "gi",
  );
  for (const match of text.matchAll(dayMonth)) {
    const phrase = match[0];
    const index = match.index ?? 0;
    candidates.push({
      index,
      length: phrase.length,
      phrase,
      build: () => {
        const month = monthNumber(match[2]);
        if (!month) return null;
        const year = match[3] ? Number(match[3]) : zonedParts(now, timeZone).year;
        const window = calendarDay(year, month, Number(match[1]), now, timeZone, Boolean(match[3]));
        return window ? { kind: "day", since: false, ...window, alternates: [] } : null;
      },
    });
  }

  const monthDay = new RegExp(
    `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(\\d{4}))?\\b`,
    "gi",
  );
  for (const match of text.matchAll(monthDay)) {
    const phrase = match[0];
    const index = match.index ?? 0;
    candidates.push({
      index,
      length: phrase.length,
      phrase,
      build: () => {
        const month = monthNumber(match[1]);
        if (!month) return null;
        const year = match[3] ? Number(match[3]) : zonedParts(now, timeZone).year;
        const window = calendarDay(year, month, Number(match[2]), now, timeZone, Boolean(match[3]));
        return window ? { kind: "day", since: false, ...window, alternates: [] } : null;
      },
    });
  }

  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const phrase = match[0];
    const index = match.index ?? 0;
    candidates.push({
      index,
      length: phrase.length,
      phrase,
      build: () => {
        const year = Number(match[3]);
        const dayFirst = calendarDay(year, Number(match[2]), Number(match[1]), now, timeZone, true);
        const monthFirst = calendarDay(year, Number(match[1]), Number(match[2]), now, timeZone, true);
        if (dayFirst && monthFirst && dayFirst.startMs !== monthFirst.startMs) {
          return { kind: "day", since: false, ...dayFirst, alternates: [monthFirst] };
        }
        const window = dayFirst ?? monthFirst;
        return window ? { kind: "day", since: false, ...window, alternates: [] } : null;
      },
    });
  }

  const weekday = new RegExp(`\\b(?:(this\\s+past|this|last|next|past|on)\\s+)?(${WEEKDAY_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(weekday)) {
    const phrase = match[0];
    const index = match.index ?? 0;
    candidates.push({
      index,
      length: phrase.length,
      phrase,
      build: () => resolveWeekday(match[1], match[2], now, timeZone),
    });
  }

  for (const match of text.matchAll(/\b(today|yesterday|tomorrow)\b/gi)) {
    const phrase = match[0];
    const index = match.index ?? 0;
    const word = phrase.toLowerCase();
    candidates.push({
      index,
      length: phrase.length,
      phrase,
      build: () => {
        const shift = word === "yesterday" ? -1 : word === "tomorrow" ? 1 : 0;
        const window = dayWindow(addZonedDays(todayStart, shift, timeZone), timeZone);
        return { kind: "day", since: false, ...window, alternates: [] };
      },
    });
  }

  candidates.sort((a, b) => a.index - b.index || b.length - a.length);
  const taken: Array<{ start: number; end: number }> = [];
  const mentions: ResolvedMention[] = [];
  for (const candidate of candidates) {
    const end = candidate.index + candidate.length;
    if (taken.some((span) => candidate.index < span.end && end > span.start)) continue;
    const built = candidate.build();
    if (!built) continue;
    taken.push({ start: candidate.index, end });
    const since = built.kind === "day" && precededBySince(text, candidate.index);
    mentions.push({
      ...built,
      since: built.since || since,
      phrase: candidate.phrase,
      index: candidate.index,
    });
  }

  const hasSince = mentions.some((mention) => mention.kind === "since-then" || mention.since);
  if (!hasSince && /\bsince\s*\??\s*$/i.test(text)) {
    const index = text.toLowerCase().lastIndexOf("since");
    mentions.push({
      phrase: "since",
      index,
      kind: "since-then",
      since: true,
      startMs: 0,
      endMs: 0,
      label: "then",
      alternates: [],
    });
  }

  mentions.sort((a, b) => a.index - b.index);
  return mentions;
}
