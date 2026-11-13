import { describe, expect, it } from "vitest";
import { canonicalUrl, mergeHits } from "../src/lib/agent/search/merge";
import type { SearchProvider } from "../src/lib/agent/search/provider";
import { runSearches } from "../src/lib/agent/search/run";
import type { SearchHit } from "../src/lib/agent/types";

function provider(search: SearchProvider["search"], live = true): SearchProvider {
  return { name: "fake", live, search };
}

describe("search orchestration", () => {
  it("runs queries in parallel and keeps going when one fails", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const search = provider(async (query) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      if (query.includes("boom")) throw new Error("down");
      return [{ url: `https://example.com/${query}`, title: query, snippet: "ok", publishedAt: null }];
    });

    const started = Date.now();
    const result = await runSearches({
      queries: [
        { q: "one", reason: "a" },
        { q: "two boom", reason: "b" },
        { q: "three", reason: "c" },
      ],
      provider: search,
      timeoutMs: 1000,
      limitPerQuery: 3,
      maxHits: 8,
      keywords: [],
    });
    expect(Date.now() - started).toBeLessThan(250);
    expect(maxInFlight).toBe(3);
    expect(result.hits.map((hit) => hit.title).sort()).toEqual(["one", "three"]);
    expect(result.errors).toHaveLength(1);
  });

  it("aborts a slow query without dropping the fast one", async () => {
    const search = provider(async (query, opts) => {
      if (query === "slow") {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 300);
          opts.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      }
      return [{ url: "https://example.com/fast", title: "fast", snippet: "ready", publishedAt: null }];
    });
    const started = Date.now();
    const result = await runSearches({
      queries: [
        { q: "slow", reason: "a" },
        { q: "fast", reason: "b" },
      ],
      provider: search,
      timeoutMs: 40,
      limitPerQuery: 2,
      maxHits: 8,
      keywords: [],
    });
    expect(Date.now() - started).toBeLessThan(250);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].title).toBe("fast");
    expect(result.errors.some((error) => error.startsWith("slow"))).toBe(true);
  });

  it("dedupes tracking params and ranks keyword matches first", () => {
    expect(canonicalUrl("https://example.com/a/?utm_source=newsletter&ref=x")).toBe("https://example.com/a");
    const hits: SearchHit[] = [
      {
        url: "https://example.com/other",
        title: "Other",
        snippet: "Nothing relevant",
        publishedAt: null,
        provider: "fake",
        query: "q",
      },
      {
        url: "https://example.com/neon?utm_campaign=1",
        title: "Neon pricing",
        snippet: "Launch is $19",
        publishedAt: "2026-11-12",
        provider: "fake",
        query: "q1",
      },
      {
        url: "https://example.com/neon/",
        title: "Neon pricing",
        snippet: "Launch is $19 per month",
        publishedAt: null,
        provider: "fake",
        query: "q2",
      },
    ];
    const merged = mergeHits(hits, ["neon"], 8);
    expect(merged).toHaveLength(2);
    expect(merged[0].url).toBe("https://example.com/neon");
    expect(merged[0].snippet).toContain("$19");
  });
});
