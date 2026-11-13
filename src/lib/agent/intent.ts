/**
 * Decide what this turn is, without a model call.
 *
 * The dataset's hard questions are pattern-shaped: "what did I ask on …",
 * "is that still correct", "has pricing changed since". A round trip to a
 * model to discover that would make the fast path slower and less predictable.
 * Anything that doesn't match falls through to a web search, which is the
 * safe default for a factual chat.
 */

import { startOfZonedDay } from "./clock";
import type { ResolvedMention } from "./types";
import type { DayWindow } from "./memory";
import type { Intent } from "./types";

export type Route = {
  intent: Intent;
  needsSearch: boolean;
  reason: string;
  mentions: ResolvedMention[];
  windows: DayWindow[];
  sinceLabel: string | null;
};

const CHAT =
  /^(hi|hello|hey|thanks|thank you|thx|ok|okay|got it|cool|great|nice|goodbye|bye|yo)[!.?\s]*$/i;

const REVERIFY = [
  /\bstill\s+(correct|true|accurate|right|valid|current)\b/i,
  /\bhas\b[^?.!]{0,80}\bchanged\b/i,
  /\bchanged\s+since\b/i,
  /\bpricing\s+changed\b/i,
  /\bsince\s+then\b/i,
  /\bstill\s+the\s+case\b/i,
  /\bup\s+to\s+date\b/i,
  /\b(has|have)\b[^?.!]{0,60}\b(shipped|launched|released)\b/i,
];

const RECALL = [
  // "just" / "exactly" can sit between "did I" and "ask".
  /\bwhat did i(?:\s+\w+){0,3}\s+ask\b/i,
  /\bwhat did (we|i)(?:\s+\w+){0,2}\s+(talk|discuss|say)\b/i,
  /\bwhat did you(?:\s+\w+){0,3}\s+(say|tell|answer|recommend)\b/i,
  /\bremind me\b/i,
  /\bdo you remember\b/i,
  /\bwhat was (my|our) (question|answer)\b/i,
  /\bwhat were we (talking|discussing)\b/i,
];

function classify(message: string): { intent: Intent; reason: string } {
  const text = message.trim();
  if (CHAT.test(text)) {
    return { intent: "chat", reason: "Greeting or thanks. Nothing to look up." };
  }
  if (REVERIFY.some((pattern) => pattern.test(text))) {
    return {
      intent: "reverify",
      reason: "Asking whether an earlier answer still holds, so memory and a fresh search both run.",
    };
  }
  if (RECALL.some((pattern) => pattern.test(text))) {
    return { intent: "recall", reason: "Asking what was said. Answer from memory, don't search." };
  }
  return { intent: "research", reason: "New question. Search, and use this conversation as context." };
}

export function buildRoute(message: string, mentions: ResolvedMention[], now: number, timeZone: string): Route {
  const classified = classify(message);
  const todayStart = startOfZonedDay(now, timeZone);
  const days = mentions.filter((mention) => mention.kind === "day");
  const past = days.filter((mention) => mention.startMs < todayStart);
  const today = days.filter((mention) => mention.startMs === todayStart);
  const other = days.filter((mention) => mention.startMs !== todayStart);

  // Prefer a day that isn't "today". "Is that still correct today?" points at
  // the other date in the sentence, not at today.
  let source = past.length ? past : other;
  if ((classified.intent === "recall" || classified.intent === "reverify") && source.length === 0) {
    source = today;
  }

  const windows: DayWindow[] = source.map((mention) => ({
    label: mention.label,
    startMs: mention.startMs,
    endMs: mention.endMs,
    alternates: mention.alternates,
  }));

  const anchor = (past[0] ?? other[0] ?? today[0]) ?? null;
  const wantsSince =
    classified.intent === "reverify" || mentions.some((mention) => mention.since || mention.kind === "since-then");

  return {
    intent: classified.intent,
    needsSearch: classified.intent === "research" || classified.intent === "reverify",
    reason: classified.reason,
    mentions,
    windows,
    sinceLabel: wantsSince && anchor ? anchor.label : null,
  };
}
