import { formatDayLabel, formatStamp } from "./clock";
import type { Route } from "./intent";
import type { RecallResult } from "./memory";
import { clip } from "./text";
import type { SearchHit, Turn } from "./types";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export function buildMessages(args: {
  message: string;
  route: Route;
  recall: RecallResult;
  recent: Turn[];
  hits: SearchHit[];
  searchState: "live" | "off" | "failed";
  searchNote?: string;
  errors: string[];
  now: number;
  timeZone: string;
}): ChatMessage[] {
  const recentIds = new Set(args.recent.flatMap((turn) => [turn.user.id, turn.assistant?.id].filter(Boolean)));
  const extraMemory = args.recall.turns.filter((turn) => !recentIds.has(turn.user.id));
  const today = formatDayLabel(args.now, args.timeZone);

  const memoryBlock = extraMemory.length
    ? extraMemory
        .map((turn) => {
          const when = formatStamp(turn.user.createdAt, args.timeZone);
          return `[${when}]\nUser: ${clip(turn.user.content, 700)}\nYou: ${clip(turn.assistant?.content ?? "(no stored answer)", 700)}`;
        })
        .join("\n\n")
    : args.recall.matchedLabel
      ? `A matching note exists and is already in this conversation (${args.recall.matchedLabel}).`
      : "(nothing stored for the date in the question)";

  const relatedBlock = args.recall.related.length
    ? args.recall.related
        .map((turn) => {
          const when = formatStamp(turn.user.createdAt, args.timeZone);
          return `[${when}] User: ${clip(turn.user.content, 240)}`;
        })
        .join("\n")
    : "";

  const dateLines = args.route.windows.length
    ? args.route.windows
        .map((window) => {
          const alt = window.alternates.length
            ? ` Alternate reading also checked: ${window.alternates.map((item) => item.label).join(", ")}.`
            : "";
          return `- ${window.label}.${alt}`;
        })
        .join("\n")
    : "(no date named)";

  const searchBlock =
    args.searchState === "off"
      ? `Not run. ${args.searchNote ?? "Do not imply that you checked the web."}`
      : args.hits.length
        ? args.hits
            .map(
              (hit, index) =>
                `[${index + 1}] ${hit.title}\n${hit.url}\n${clip(hit.snippet, 420)}${hit.publishedAt ? `\nPublished: ${hit.publishedAt}` : ""}`,
            )
            .join("\n\n")
        : `Ran, and came back empty. ${args.errors.slice(0, 3).join(" | ")}`;

  const system = [
    "You are Since. You remember this user's earlier conversations because they are quoted below, with their dates. You do not have a memory tool. You have one tool, web_search, and only when it is offered on this request.",
    `Now: ${formatStamp(args.now, args.timeZone)} (${args.timeZone}). Today is ${today}.`,
    "",
    "How to answer:",
    "- Lead with the result. Sound like a careful colleague, not a search engine.",
    "- Use the resolved dates below. Do not pick a different day. If the matching note was on the alternate reading, say which day you used.",
    "- When you use a past turn, give its date and a short quotation of the question and your earlier answer.",
    `- Prices, plans, launches, and anything else that goes stale must come from today's search results and be cited as [1], [2]. Say "as of ${today}".`,
    "- If the results are empty, off, conflicting, or silent on the question, say so. Never invent a price, a product change, or a shortlist.",
    "- If the user says \"them\" or \"those tools\" and the names are not in the message or the memory, ask which ones.",
    "- If no search was run, do not imply you checked the web.",
    "- If an old figure and a new source disagree, say what changed. If a figure shows up again, say that figure still appears and cite it. Do not declare the whole old answer correct unless the sources support it.",
    "- Keep it short unless they asked you to compare several things.",
    "",
    `Route: ${args.route.intent}. ${args.route.reason}`,
    args.route.sinceLabel ? `Freshness window starts: ${args.route.sinceLabel}.` : "",
    "",
    "Resolved dates:",
    dateLines,
    args.recall.checkedLabels.length ? `Days actually opened: ${args.recall.checkedLabels.join("; ")}.` : "",
    args.recall.matchedLabel ? `Matched: ${args.recall.matchedLabel}.` : "Matched: nothing.",
    "",
    "Notes from outside this conversation:",
    memoryBlock,
    relatedBlock ? `\nClosest notes on other days:\n${relatedBlock}` : "",
    "",
    "Search results:",
    searchBlock,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const history: ChatMessage[] = [];
  for (const turn of args.recent) {
    history.push({ role: "user", content: turn.user.content });
    if (turn.assistant) history.push({ role: "assistant", content: turn.assistant.content });
  }

  return [{ role: "system", content: system }, ...history, { role: "user", content: args.message }];
}
