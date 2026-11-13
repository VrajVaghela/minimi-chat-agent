/**
 * One turn of Since.
 *
 * The model is allowed a single tool: web_search. Remembering what was said,
 * and resolving "last Tuesday", happens here, before the model speaks. Those
 * steps are deterministic, so a tool the model might skip would only add a
 * round trip and a way to be wrong.
 *
 * When the route is obvious we call web_search ourselves, in parallel, and
 * hand over the results. The model may call that same tool once more, and
 * only if the first pass came back empty.
 */

import { resolveMentions } from "./dates";
import { buildRoute, type Route } from "./intent";
import { MemoryStore, type RecallResult } from "./memory";
import type { ModelClient } from "./openai";
import { planQueries } from "./plan";
import { buildMessages, type ChatMessage } from "./prompt";
import { mergeHits } from "./search/merge";
import type { SearchProvider } from "./search/provider";
import { runSearches } from "./search/run";
import { synthesize, textChunks } from "./synthesize";
import { clip, keywords, titleFrom } from "./text";
import { parseSearchQuery } from "./tools";
import type { AgentEvent, Citation, PlannedQuery, RouteNote, SearchHit, StoredMessage } from "./types";

export type HandleInput = {
  store: MemoryStore;
  search: SearchProvider;
  model: ModelClient | null;
  now: number;
  timeZone: string;
  conversationId?: string;
  message: string;
  signal?: AbortSignal;
};

export async function* handleTurn(input: HandleInput): AsyncGenerator<AgentEvent> {
  try {
    yield* runTurn(input);
  } catch (error) {
    if (input.signal?.aborted) return;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    yield { type: "error", data: { message } };
  }
}

async function* runTurn(input: HandleInput): AsyncGenerator<AgentEvent> {
  const message = input.message.trim();
  if (!message) {
    yield { type: "error", data: { message: "Write a message first." } };
    return;
  }

  let conversationId = input.conversationId;
  if (!conversationId) {
    conversationId = input.store.createConversation(input.now).id;
  } else if (!input.store.getConversation(conversationId)) {
    yield { type: "error", data: { message: "That conversation is gone. Start a new one." } };
    return;
  }

  const mentions = resolveMentions(message, input.now, input.timeZone);
  const route = buildRoute(message, mentions, input.now, input.timeZone);
  const words = keywords(message);

  yield {
    type: "status",
    data: {
      phase: "memory",
      detail: route.windows.length
        ? `Checking ${route.windows.map((window) => window.label).join(" and ")}`
        : route.intent === "chat"
          ? "Nothing to look up"
          : "Looking through recent notes",
    },
  };

  let recall = input.store.recall({
    windows: route.windows,
    keywords: words,
    limit: 6,
    preferDay: words.length === 0 || /\b(them|those|these|any of them|the shortlist)\b/i.test(message),
  });

  if (
    recall.turns.length === 0 &&
    route.windows.length === 0 &&
    (route.intent === "recall" || route.intent === "reverify")
  ) {
    const local = input.store.recentTurns(conversationId, 4);
    const turns = local.length ? local : input.store.recentTurns(undefined, 4);
    recall = {
      ...recall,
      turns,
      matchedLabel: turns.length ? "this conversation" : null,
    };
  }

  const recalledText = recall.turns
    .map((turn) => `${turn.user.content}\n${turn.assistant?.content ?? ""}`)
    .join("\n");
  const queries = planQueries({
    message,
    route,
    recalledText,
    now: input.now,
    timeZone: input.timeZone,
  });

  let hits: SearchHit[] = [];
  let errors: string[] = [];
  let searchState: RouteNote["search"] = "off";
  const asked = queries.map((query) => query.q);

  if (queries.length && input.search.live) {
    yield { type: "status", data: { phase: "search", detail: searchDetail(queries) } };
    const result = await runSearches({
      queries,
      provider: input.search,
      timeoutMs: 8000,
      limitPerQuery: 4,
      maxHits: 8,
      keywords: [...words, ...keywords(recalledText)].slice(0, 12),
      signal: input.signal,
    });
    hits = result.hits;
    errors = result.errors;
    searchState = hits.length ? "live" : "failed";
  } else if (queries.length) {
    yield {
      type: "status",
      data: { phase: "search", detail: input.search.note ?? "Search is off" },
    };
  }

  if (input.signal?.aborted) return;

  // One more search, chosen by the model, only when we needed the web and got nothing.
  let prewritten: string | null = null;
  const allowFollowUp = Boolean(
    input.model && input.search.live && route.needsSearch && hits.length === 0 && queries.length,
  );
  if (allowFollowUp && input.model) {
    yield { type: "status", data: { phase: "search", detail: "Nothing useful yet. Trying one more query." } };
    const draft = messagesFor(input, conversationId, message, route, recall, hits, searchState, errors);
    const first = await input.model.complete({ messages: draft, tools: true, signal: input.signal });
    const calls = first.toolCalls
      .filter((call) => call.name === "web_search")
      .map((call) => ({ call, q: parseSearchQuery(call.arguments) }))
      .filter((item): item is { call: (typeof first.toolCalls)[number]; q: string } => Boolean(item.q))
      .slice(0, 3);

    if (calls.length) {
      for (const call of calls) asked.push(call.q);
      const extra = await runSearches({
        queries: calls.map((call) => ({ q: call.q, reason: "Model follow-up" })),
        provider: input.search,
        timeoutMs: 8000,
        limitPerQuery: 4,
        maxHits: 8,
        keywords: [...words, ...keywords(recalledText)].slice(0, 12),
        signal: input.signal,
      });
      errors = [...errors, ...extra.errors];
      hits = mergeHits([...hits, ...extra.hits], [...words, ...keywords(recalledText)], 8);
      if (hits.length) searchState = "live";
    } else if (first.content.trim()) {
      prewritten = first.content.trim();
    }
  }

  if (input.signal?.aborted) return;

  const note = routeNote(route, recall, asked, searchState);
  yield { type: "meta", data: { conversationId, ...note } };

  const citations = toCitations(hits, input.now);
  if (citations.length) yield { type: "citations", data: { citations } };

  yield { type: "status", data: { phase: "writing", detail: "Writing" } };

  let text = "";
  const useModel = Boolean(input.model) && route.intent !== "chat";
  if (prewritten) {
    text = prewritten;
    for (const chunk of textChunks(prewritten)) yield { type: "token", data: { text: chunk } };
  } else if (useModel && input.model) {
    const messages = messagesFor(input, conversationId, message, route, recall, hits, searchState, errors);
    for await (const delta of input.model.stream({ messages, tools: false, signal: input.signal })) {
      text += delta.text;
      yield { type: "token", data: { text: delta.text } };
    }
  }

  if (!text.trim()) {
    const fallback = synthesize({
      message,
      route,
      recall,
      hits,
      searchState,
      searchNote: input.search.note,
      errors,
      now: input.now,
      timeZone: input.timeZone,
    });
    text = fallback;
    for (const chunk of textChunks(fallback)) yield { type: "token", data: { text: chunk } };
  }

  if (input.signal?.aborted) return;

  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const stored: StoredMessage[] = [
    {
      id: userId,
      conversationId,
      role: "user",
      content: message,
      createdAt: input.now,
    },
    {
      id: assistantId,
      conversationId,
      role: "assistant",
      content: text,
      createdAt: input.now + 1,
      citations,
      route: note,
    },
  ];
  input.store.appendAll(stored);
  input.store.renameIfUntitled(conversationId, titleFrom(message));
  const title = input.store.getConversation(conversationId)?.title ?? titleFrom(message);

  yield {
    type: "done",
    data: { conversationId, title, userId, assistantId },
  };
}

function messagesFor(
  input: HandleInput,
  conversationId: string,
  message: string,
  route: Route,
  recall: RecallResult,
  hits: SearchHit[],
  searchState: RouteNote["search"],
  errors: string[],
): ChatMessage[] {
  return buildMessages({
    message,
    route,
    recall,
    recent: input.store.recentTurns(conversationId, 6),
    hits,
    searchState,
    searchNote: input.search.note,
    errors,
    now: input.now,
    timeZone: input.timeZone,
  });
}

function routeNote(route: Route, recall: RecallResult, queries: string[], search: RouteNote["search"]): RouteNote {
  return {
    intent: route.intent,
    reason: route.reason,
    dates: recall.checkedLabels,
    matchedDate: recall.matchedLabel,
    queries,
    search,
  };
}

function toCitations(hits: SearchHit[], now: number): Citation[] {
  return hits.map((hit, index) => ({
    n: index + 1,
    url: hit.url,
    title: hit.title,
    snippet: hit.snippet.slice(0, 500),
    publishedAt: hit.publishedAt,
    retrievedAt: new Date(now).toISOString(),
    query: hit.query,
    provider: hit.provider,
  }));
}

function searchDetail(queries: PlannedQuery[]): string {
  const names = queries
    .map((query) => query.reason.replace(/^Recheck /, ""))
    .filter((name) => name !== "the earlier claim");
  const looksNamed = names.length === queries.length && names.every((name) => /^[A-Z0-9]/.test(name));
  if (looksNamed && names.length >= 2) return `Searching ${names.join(", ")}`;
  if (queries.length === 1) return `Searching “${clip(queries[0].q, 90)}”`;
  return `Searching ${queries.length} queries`;
}
