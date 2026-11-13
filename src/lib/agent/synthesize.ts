/**
 * The answer path when no model key is set.
 *
 * It quotes stored turns and today's sources, and it refuses to call an old
 * price "still correct" unless that exact figure shows up again. A model, when
 * configured, replaces this. The rules are the same either way.
 */

import { formatDayLabel, formatStamp } from "./clock";
import type { Route } from "./intent";
import type { RecallResult } from "./memory";
import { clip } from "./text";
import type { SearchHit, Turn } from "./types";

export function synthesize(args: {
  message: string;
  route: Route;
  recall: RecallResult;
  hits: SearchHit[];
  searchState: "live" | "off" | "failed";
  searchNote?: string;
  errors: string[];
  now: number;
  timeZone: string;
}): string {
  if (args.route.intent === "chat") return chatReply(args.message);
  if (args.route.intent === "recall") return recallReply(args);
  if (args.route.intent === "reverify") return reverifyReply(args);
  return researchReply(args);
}

export function* textChunks(text: string): Generator<string> {
  if (!text) return;
  const parts = text.split(/(\n\n)/);
  let buffer = "";
  for (const part of parts) {
    buffer += part;
    if (part === "\n\n" || buffer.length > 90) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer) yield buffer;
}

function chatReply(message: string): string {
  if (/thank/i.test(message)) return "You're welcome.";
  if (/\b(bye|goodbye)\b/i.test(message)) {
    return "Talk later. Ask me then if anything I said is still true.";
  }
  return "Hello. Ask me something you may want to check again later, or ask what you asked on a given day.";
}

function quote(text: string): string {
  return `“${clip(text, 420)}”`;
}

function turnBlock(turns: Turn[]): string {
  return turns
    .slice(0, 3)
    .map((turn) => {
      const answer = turn.assistant?.content ?? "I don't have a stored answer for that.";
      return `You asked:\n\n${quote(turn.user.content)}\n\nI answered:\n\n${quote(answer)}`;
    })
    .join("\n\n");
}

function dateLead(route: Route, recall: RecallResult): string {
  if (!recall.matchedLabel || recall.matchedLabel === "this conversation") return "";
  const primary = route.windows.map((window) => window.label);
  const usedAlternate = primary.length > 0 && !primary.some((label) => recall.matchedLabel?.includes(label));
  if (!usedAlternate) return "";
  return `I checked ${primary.join(" and ")} first and found nothing that matches. The note I do have is from ${recall.matchedLabel}.\n\n`;
}

function whenPhrase(recall: RecallResult): string {
  if (recall.matchedLabel && recall.matchedLabel !== "this conversation") {
    return `On ${recall.matchedLabel}`;
  }
  return "Most recently";
}

function amounts(text: string): string[] {
  return [...text.matchAll(/\$\d+(?:,\d{3})*(?:\.\d+)?/g)].map((match) => match[0]);
}

function sourceBlock(hits: SearchHit[]): string {
  return hits.map((hit, index) => `[${index + 1}] ${hit.title}\n${hit.snippet}`).join("\n\n");
}

function comparePrices(oldText: string, hits: SearchHit[]): string {
  const oldAmounts = [...new Set(amounts(oldText))];
  const freshAmounts = [...new Set(hits.flatMap((hit) => amounts(`${hit.title} ${hit.snippet}`)))];
  if (!oldAmounts.length && !freshAmounts.length) {
    return "Neither the earlier note nor today's sources state a price, so there is no figure to confirm or retire.";
  }
  if (!oldAmounts.length) {
    return `The earlier note didn't name a price. Today's sources mention ${freshAmounts.join(", ")}.`;
  }
  if (!freshAmounts.length) {
    return `The earlier note mentions ${oldAmounts.join(", ")}. Today's sources don't restate a price, so I can't confirm ${oldAmounts.length > 1 ? "those figures" : "that figure"}.`;
  }
  const still = oldAmounts.filter((amount) => freshAmounts.includes(amount));
  const novel = freshAmounts.filter((amount) => !oldAmounts.includes(amount));
  const bits: string[] = [];
  if (still.length) bits.push(`${still.join(", ")} still appears in today's sources.`);
  if (novel.length && still.length) {
    bits.push(
      `Today's sources also mention ${novel.join(", ")}, which was not in the earlier note, so I would not treat the old figure as the only current one.`,
    );
  }
  if (!still.length) {
    bits.push(
      `The earlier note says ${oldAmounts.join(", ")}, and today's sources say ${freshAmounts.join(", ")}. Those are not the same, so the old answer should not be treated as current.`,
    );
  }
  return bits.join(" ");
}

function recallReply(args: Parameters<typeof synthesize>[0]): string {
  if (!args.recall.turns.length) {
    const checked = args.recall.checkedLabels;
    const head = checked.length
      ? `I don't have anything from ${checked.join(" or ")}.`
      : "I don't have an earlier question to quote.";
    const related = relatedSentence(args.recall, args.timeZone);
    return related ? `${head} ${related}` : head;
  }
  const lead = dateLead(args.route, args.recall);
  const body = [
    `${whenPhrase(args.recall)}, this is what I have.`,
    "",
    turnBlock(args.recall.turns),
    "",
    "I didn't search again. You asked what was said, not whether it is still true.",
  ].join("\n");
  return `${lead}${body}`.trim();
}

function relatedSentence(recall: RecallResult, timeZone: string): string {
  const turn = recall.related[0];
  if (!turn) return "";
  const when = formatStamp(turn.user.createdAt, timeZone);
  return `The closest note is from ${when}, when you asked ${quote(turn.user.content)}`;
}

function reverifyReply(args: Parameters<typeof synthesize>[0]): string {
  const today = formatDayLabel(args.now, args.timeZone);
  if (!args.recall.turns.length) {
    const checked = args.recall.checkedLabels;
    const head = checked.length
      ? `I don't have a note from ${checked.join(" or ")}, so I don't know which claim to recheck.`
      : "I don't have an earlier answer to recheck.";
    const related = relatedSentence(args.recall, args.timeZone);
    const ask = related ? related : "Name the products or the claim and I'll look them up.";
    return [head, ask, searchFooter(args, today)].filter(Boolean).join("\n\n");
  }

  const old = args.recall.turns.map((turn) => turn.assistant?.content ?? "").join("\n");
  const body = [
    dateLead(args.route, args.recall),
    `${whenPhrase(args.recall)}, you asked:`,
    "",
    quote(args.recall.turns[0].user.content),
    "",
    "I answered:",
    "",
    quote(args.recall.turns[0].assistant?.content ?? "I don't have a stored answer."),
  ];

  if (args.searchState === "off") {
    body.push(
      "",
      `I can't check the live web from here${args.searchNote ? ` (${args.searchNote.replace(/\.$/, "").replace(/^[A-Z]/, (letter) => letter.toLowerCase())})` : ""}, so I won't say whether this is still true as of ${today}.`,
    );
    return body.join("\n").trim();
  }

  if (!args.hits.length) {
    body.push(
      "",
      `I searched again as of ${today} and got nothing usable${args.errors.length ? ` (${args.errors[0]})` : ""}. I won't say the earlier answer is still true.`,
    );
    return body.join("\n").trim();
  }

  body.push("", `I searched again as of ${today}.`, "", sourceBlock(args.hits), "", comparePrices(old, args.hits));
  return body.join("\n").trim();
}

function researchReply(args: Parameters<typeof synthesize>[0]): string {
  const today = formatDayLabel(args.now, args.timeZone);
  if (args.searchState === "off") {
    return `I can't look that up. ${args.searchNote ?? "No search API key is set."} I won't guess. Memory of this conversation still works without a key.`;
  }
  if (!args.hits.length) {
    return `I searched as of ${today} and didn't get a usable source${args.errors.length ? ` (${args.errors[0]})` : ""}. I don't have an answer.`;
  }
  return `As of ${today}, here is what search returned. No model key is set, so this is the source text rather than a summary.\n\n${sourceBlock(args.hits)}`;
}

function searchFooter(args: Parameters<typeof synthesize>[0], today: string): string {
  if (args.searchState === "off") {
    return `I also can't check the live web until a search key is set, so there is nothing new as of ${today}.`;
  }
  if (!args.hits.length) return "";
  return `I searched anyway, as of ${today}:\n\n${sourceBlock(args.hits)}`;
}
