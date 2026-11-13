import { describe, expect, it } from "vitest";
import { zonedTimeToUtc } from "../src/lib/agent/clock";
import { MemoryStore } from "../src/lib/agent/memory";
import type { ModelClient, ModelRequest } from "../src/lib/agent/openai";
import { handleTurn } from "../src/lib/agent/orchestrator";
import type { SearchProvider } from "../src/lib/agent/search/provider";
import type { AgentEvent, StoredMessage } from "../src/lib/agent/types";

const TZ = "Asia/Kolkata";
const NOW = Date.parse("2026-11-13T04:30:00.000Z");

function at(day: number, hour = 10) {
  return zonedTimeToUtc(2026, 11, day, hour, 0, 0, TZ);
}

async function collect(input: Parameters<typeof handleTurn>[0]) {
  const events: AgentEvent[] = [];
  for await (const event of handleTurn(input)) events.push(event);
  return events;
}

function text(events: AgentEvent[]) {
  return events
    .filter((event): event is Extract<AgentEvent, { type: "token" }> => event.type === "token")
    .map((event) => event.data.text)
    .join("");
}

function add(
  store: MemoryStore,
  when: number,
  user: string,
  assistant: string,
) {
  const conversation = store.createConversation(when, user.slice(0, 24));
  const messages: StoredMessage[] = [
    { id: crypto.randomUUID(), conversationId: conversation.id, role: "user", content: user, createdAt: when },
    {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      content: assistant,
      createdAt: when + 1,
    },
  ];
  store.appendAll(messages);
  return conversation;
}

function scriptedSearch(reply: (query: string) => { title: string; snippet: string; url: string } | null) {
  const calls: string[] = [];
  let inFlight = 0;
  const stats = { maxInFlight: 0 };
  const search: SearchProvider = {
    name: "fake",
    live: true,
    async search(query) {
      calls.push(query);
      inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      const hit = reply(query);
      return hit ? [{ ...hit, publishedAt: null }] : [];
    },
  };
  return { search, calls, stats };
}

describe("orchestrator", () => {
  it("rechecks each CRM from Monday in parallel and does not invent a verdict", async () => {
    const store = MemoryStore.empty();
    add(
      store,
      at(9),
      "Shortlist for the 20-person sales team: HubSpot, Attio, Pipedrive, Close, and Folk.",
      "Noted those five — HubSpot, Attio, Pipedrive, Close, and Folk. I have not checked pricing.",
    );
    const { search, calls, stats } = scriptedSearch((query) => {
      if (query.startsWith("HubSpot")) {
        return {
          url: "https://example.com/hubspot?utm_source=test",
          title: "HubSpot pricing update",
          snippet: "Sales Hub Starter is now $20/seat.",
        };
      }
      return {
        url: `https://example.com/${encodeURIComponent(query.slice(0, 16))}`,
        title: "No change found",
        snippet: "No pricing change announced.",
      };
    });

    const events = await collect({
      store,
      search,
      model: null,
      now: NOW,
      timeZone: TZ,
      message:
        "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?",
    });

    expect(calls).toHaveLength(5);
    expect(stats.maxInFlight).toBe(5);
    for (const name of ["HubSpot", "Attio", "Pipedrive", "Close", "Folk"]) {
      expect(calls.some((query) => query.includes(name))).toBe(true);
    }
    const answer = text(events);
    expect(answer).toContain("Monday, 9 November 2026");
    expect(answer).toContain("HubSpot");
    expect(answer).toContain("$20");
    expect(answer.toLowerCase()).not.toContain("still true");
    const meta = events.find((event) => event.type === "meta");
    expect(meta?.type === "meta" && meta.data.search).toBe("live");
    expect(meta?.type === "meta" && meta.data.intent).toBe("reverify");
  });

  it("quotes last Tuesday's Postgres answer and only calls a price current when the figure reappears", async () => {
    const store = MemoryStore.empty();
    add(
      store,
      at(10, 16),
      "What did managed Postgres cost? Compare Neon, Supabase, and RDS.",
      "Neon Launch is $19/month, Supabase Pro is $25/month, and RDS is about $15/month.",
    );
    const { search, calls } = scriptedSearch((query) => {
      const price = query.startsWith("Neon") ? "$19" : query.startsWith("Supabase") ? "$25" : "$15";
      return { url: `https://example.com/${price}`, title: query.slice(0, 12), snippet: `Listed at ${price} per month.` };
    });
    const events = await collect({
      store,
      search,
      model: null,
      now: NOW,
      timeZone: TZ,
      message: "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
    });
    expect(calls.map((query) => query.split(" ")[0])).toEqual(["Neon", "Supabase", "RDS"]);
    const answer = text(events);
    expect(answer).toContain("Tuesday, 10 November 2026");
    expect(answer).toContain("$19, $25, $15 still appears");
  });

  it("answers a pure memory question without searching", async () => {
    const store = MemoryStore.empty();
    add(store, at(3, 11), "Is Linear's free tier enough for 20 people?", "Standard is $10 per user/month.");
    const { search, calls } = scriptedSearch(() => {
      throw new Error("should not search");
    });
    const events = await collect({
      store,
      search,
      model: null,
      now: NOW,
      timeZone: TZ,
      message: "What did I ask you on 3 November?",
    });
    expect(calls).toHaveLength(0);
    expect(text(events)).toContain("Linear");
    expect(text(events)).toContain("didn't search");
    expect(events.find((event) => event.type === "meta")?.type === "meta").toBe(true);
  });

  it("uses the earlier reading of last Tuesday when the recent one is empty", async () => {
    const store = MemoryStore.empty();
    add(store, at(3, 15), "Postgres hosting for a small team.", "Look at Neon.");
    const { search } = scriptedSearch(() => ({
      url: "https://example.com/neon",
      title: "Neon",
      snippet: "No price listed.",
    }));
    const answer = text(
      await collect({
        store,
        search,
        model: null,
        now: NOW,
        timeZone: TZ,
        message: "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
      }),
    );
    expect(answer).toContain("Tuesday, 10 November 2026");
    expect(answer).toContain("Tuesday, 3 November 2026");
    expect(answer).toContain("Postgres hosting");
  });

  it("refuses to confirm an old price when search is not configured", async () => {
    const store = MemoryStore.empty();
    add(store, at(3, 11), "What does Linear cost?", "Standard is $10 per user/month.");
    const events = await collect({
      store,
      search: { name: "mock", live: false, note: "No search API key is set.", async search() { return []; } },
      model: null,
      now: NOW,
      timeZone: TZ,
      message: "What did I ask you on 3 November? Is your answer still correct today?",
    });
    const answer = text(events);
    expect(answer).toContain("$10");
    expect(answer).toContain("won't say");
    expect(answer.toLowerCase()).not.toContain("still correct");
    const meta = events.find((event) => event.type === "meta");
    expect(meta?.type === "meta" && meta.data.search).toBe("off");
  });

  it("remembers the previous turn in this conversation", async () => {
    const store = MemoryStore.empty();
    const search: SearchProvider = {
      name: "fake",
      live: true,
      async search() {
        return [{ url: "https://example.com/pg", title: "Postgres hosts", snippet: "Neon and RDS are the usual pair.", publishedAt: null }];
      },
    };
    const first = await collect({
      store,
      search,
      model: null,
      now: NOW,
      timeZone: TZ,
      message: "What is a fair Postgres host for a small team?",
    });
    const done = first.find((event) => event.type === "done");
    expect(done?.type).toBe("done");
    const conversationId = done?.type === "done" ? done.data.conversationId : "";
    let secondCalls = 0;
    const second = await collect({
      store,
      search: {
        name: "fake",
        live: true,
        async search() {
          secondCalls += 1;
          return [];
        },
      },
      model: null,
      now: NOW + 60_000,
      timeZone: TZ,
      conversationId,
      message: "What did I just ask you?",
    });
    expect(secondCalls).toBe(0);
    expect(text(second)).toContain("Postgres host");
  });

  it("does not hand the model a tool when search already returned sources", async () => {
    const store = MemoryStore.empty();
    const seen: ModelRequest[] = [];
    const model: ModelClient = {
      async complete(req) {
        seen.push(req);
        return { content: "", toolCalls: [] };
      },
      async *stream(req) {
        seen.push(req);
        yield { type: "text", text: "Neon is listed at $19 in [1]." };
      },
    };
    const answer = text(
      await collect({
        store,
        search: {
          name: "fake",
          live: true,
          async search() {
            return [{ url: "https://neon.tech/pricing", title: "Neon pricing", snippet: "Launch is $19/month.", publishedAt: null }];
          },
        },
        model,
        now: NOW,
        timeZone: TZ,
        message: "What does Neon cost for a small team?",
      }),
    );
    expect(answer).toBe("Neon is listed at $19 in [1].");
    expect(seen).toHaveLength(1);
    expect(seen[0].tools).toBe(false);
    expect(seen[0].messages[0].content).toContain("Neon pricing");
  });

  it("lets the model call web_search once when the first pass is empty", async () => {
    const store = MemoryStore.empty();
    const queries: string[] = [];
    let completes = 0;
    const model: ModelClient = {
      async complete(req) {
        completes += 1;
        expect(req.tools).toBe(true);
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "web_search", arguments: JSON.stringify({ query: "neon-retry pricing" }) }],
        };
      },
      async *stream(req) {
        expect(req.tools).toBe(false);
        expect(req.messages.some((message) => message.content.includes("Neon pricing"))).toBe(true);
        yield { type: "text", text: "Checked [1]." };
      },
    };
    const answer = text(
      await collect({
        store,
        search: {
          name: "fake",
          live: true,
          async search(query) {
            queries.push(query);
            if (!query.includes("neon-retry")) return [];
            return [{ url: "https://neon.tech/pricing", title: "Neon pricing", snippet: "Launch is $19/month.", publishedAt: null }];
          },
        },
        model,
        now: NOW,
        timeZone: TZ,
        message: "What does Neon cost now?",
      }),
    );
    expect(completes).toBe(1);
    expect(queries.some((query) => query.includes("neon-retry"))).toBe(true);
    expect(answer).toBe("Checked [1].");
  });

  it("answers thanks without a model or a search", async () => {
    let called = 0;
    const model: ModelClient = {
      async complete() {
        called += 1;
        return { content: "", toolCalls: [] };
      },
      async *stream() {
        called += 1;
        yield { type: "text", text: "nope" };
      },
    };
    const answer = text(
      await collect({
        store: MemoryStore.empty(),
        search: {
          name: "fake",
          live: true,
          async search() {
            called += 1;
            return [];
          },
        },
        model,
        now: NOW,
        timeZone: TZ,
        message: "thanks!",
      }),
    );
    expect(called).toBe(0);
    expect(answer).toContain("welcome");
  });
});
