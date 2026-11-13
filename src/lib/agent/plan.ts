/**
 * Turn a route plus the recalled notes into parallel search queries.
 *
 * One query per named product, not one blended query. "Have any of these five
 * changed?" has to be allowed to say that four were quiet and one wasn't.
 * A single query tends to bury that.
 */

import { zonedParts } from "./clock";
import type { Route } from "./intent";
import { extractEntities, keywords, stripPoliteness } from "./text";
import type { PlannedQuery } from "./types";

export function planQueries(args: {
  message: string;
  route: Route;
  recalledText: string;
  now: number;
  timeZone: string;
}): PlannedQuery[] {
  if (!args.route.needsSearch) return [];

  const year = zonedParts(args.now, args.timeZone).year;
  const since = args.route.sinceLabel;

  if (args.route.intent === "reverify") {
    // Names in the notes beat names in the new message. "Has any of them
    // changed?" does not itself contain the five tools.
    const fromMemory = extractEntities(args.recalledText);
    const entities = (fromMemory.length ? fromMemory : extractEntities(args.message)).slice(0, 5);

    if (entities.length) {
      return entities.map((name) => ({
        q: clipQuery(
          since
            ? `${name} pricing and product changes since ${since}`
            : `${name} pricing and product changes ${year}`,
        ),
        reason: `Recheck ${name}`,
      }));
    }

    const topic = [...new Set([...keywords(args.message), ...keywords(args.recalledText)])].slice(0, 6).join(" ");
    return [
      {
        q: clipQuery(
          since ? `${topic || "pricing"} changes since ${since}` : `${topic || stripPoliteness(args.message)} ${year}`,
        ),
        reason: "Recheck the earlier claim",
      },
    ];
  }

  const cleaned = stripPoliteness(args.message);
  const queries: PlannedQuery[] = [{ q: clipQuery(cleaned), reason: "The question as asked" }];
  if (!cleaned.includes(String(year))) {
    queries.push({ q: clipQuery(`${cleaned} ${year}`), reason: "Prefer sources from this year" });
  }
  return queries.slice(0, 3);
}

function clipQuery(query: string): string {
  const clean = query.replace(/\s+/g, " ").trim();
  return clean.length > 180 ? clean.slice(0, 180).trim() : clean;
}
