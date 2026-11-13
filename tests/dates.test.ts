import { describe, expect, it } from "vitest";
import { zonedParts } from "../src/lib/agent/clock";
import { resolveMentions } from "../src/lib/agent/dates";

const TZ = "Asia/Kolkata";
/** Friday 13 November 2026, 10:00 in Asia/Kolkata. */
const NOW = Date.parse("2026-11-13T04:30:00.000Z");

function day(phrase: string, now = NOW) {
  const mentions = resolveMentions(phrase, now, TZ).filter((mention) => mention.kind === "day");
  return mentions[0];
}

function ymd(ms: number) {
  const parts = zonedParts(ms, TZ);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

describe("date resolution", () => {
  it("reads a bare weekday as the most recent one, including today", () => {
    expect(ymd(day("On Monday we shortlisted five tools").startMs)).toBe("2026-11-09");
    expect(day("On Monday we shortlisted five tools").label).toBe("Monday, 9 November 2026");
    expect(ymd(day("Friday").startMs)).toBe("2026-11-13");
  });

  it("treats last Tuesday as the recent one and keeps the previous week as an alternate", () => {
    const mention = day("Last Tuesday I asked you about Postgres hosting");
    expect(ymd(mention.startMs)).toBe("2026-11-10");
    expect(mention.alternates).toHaveLength(1);
    expect(ymd(mention.alternates[0].startMs)).toBe("2026-11-03");
    expect(mention.phrase.toLowerCase()).toContain("last tuesday");
  });

  it("does not add an alternate when last Tuesday is already outside this week", () => {
    const tuesday = Date.parse("2026-11-10T04:30:00.000Z");
    const mention = day("last Tuesday", tuesday);
    expect(ymd(mention.startMs)).toBe("2026-11-03");
    expect(mention.alternates).toHaveLength(0);
  });

  it("resolves this, past, and next weekdays", () => {
    expect(ymd(day("this Saturday").startMs)).toBe("2026-11-14");
    expect(ymd(day("this past Tuesday").startMs)).toBe("2026-11-10");
    expect(day("this past Tuesday").alternates).toHaveLength(0);
    expect(ymd(day("next Monday").startMs)).toBe("2026-11-16");
  });

  it("resolves 3 November, November 3, and a future month-day to last year", () => {
    expect(ymd(day("What did I ask you on 3 November?").startMs)).toBe("2026-11-03");
    expect(ymd(day("on November 3, 2026").startMs)).toBe("2026-11-03");
    expect(ymd(day("3rd of November").startMs)).toBe("2026-11-03");
    expect(ymd(day("3 Nov 2026").startMs)).toBe("2026-11-03");
    expect(ymd(day("What happened on 20 November?").startMs)).toBe("2025-11-20");
  });

  it("keeps today and yesterday as calendar days", () => {
    expect(ymd(day("still correct today").startMs)).toBe("2026-11-13");
    expect(ymd(day("yesterday").startMs)).toBe("2026-11-12");
  });

  it("parses ISO dates and rejects impossible days", () => {
    expect(ymd(day("on 2026-11-03").startMs)).toBe("2026-11-03");
    expect(resolveMentions("31 February 2026", NOW, TZ)).toHaveLength(0);
  });

  it("prefers day-first slash dates and falls back when that reading is impossible", () => {
    const both = day("on 3/11/2026");
    expect(ymd(both.startMs)).toBe("2026-11-03");
    expect(ymd(both.alternates[0].startMs)).toBe("2026-03-11");
    expect(ymd(day("on 13/11/2026").startMs)).toBe("2026-11-13");
    expect(day("on 13/11/2026").alternates).toHaveLength(0);
    expect(ymd(day("on 11/13/2026").startMs)).toBe("2026-11-13");
  });

  it("marks since-phrases without dropping the day", () => {
    const sinceMonday = day("changed since Monday");
    expect(sinceMonday.since).toBe(true);
    expect(ymd(sinceMonday.startMs)).toBe("2026-11-09");
    const mentions = resolveMentions("Has any pricing changed since then?", NOW, TZ);
    expect(mentions.some((mention) => mention.kind === "since-then")).toBe(true);
    const trailing = resolveMentions("Has any of them changed pricing since?", NOW, TZ);
    expect(trailing.some((mention) => mention.kind === "since-then")).toBe(true);
  });

  it("does not treat a lowercase may as a month", () => {
    const mentions = resolveMentions("May I ask what we said on Monday", NOW, TZ);
    expect(mentions).toHaveLength(1);
    expect(ymd(mentions[0].startMs)).toBe("2026-11-09");
  });

  it("covers a full day, exclusive of the next midnight", () => {
    const mention = day("3 November");
    expect(mention.endMs - mention.startMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ymd(mention.endMs)).toBe("2026-11-04");
  });
});
