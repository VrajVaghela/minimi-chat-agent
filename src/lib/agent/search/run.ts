/**
 * Run the planned queries together.
 *
 * A slow or dead source must not sink the turn: each query has its own
 * timeout, and failures are reported beside whatever did come back.
 */

import type { PlannedQuery, SearchHit } from "../types";
import { mergeHits } from "./merge";
import type { SearchProvider } from "./provider";

export async function runSearches(args: {
  queries: PlannedQuery[];
  provider: SearchProvider;
  timeoutMs: number;
  limitPerQuery: number;
  maxHits: number;
  keywords: string[];
  signal?: AbortSignal;
}): Promise<{ hits: SearchHit[]; errors: string[] }> {
  const errors: string[] = [];
  const batches = await Promise.all(
    args.queries.map(async (query) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), args.timeoutMs);
      const onAbort = () => controller.abort();
      args.signal?.addEventListener("abort", onAbort);
      try {
        const rows = await args.provider.search(query.q, {
          limit: args.limitPerQuery,
          signal: controller.signal,
        });
        return rows.map(
          (row): SearchHit => ({
            url: row.url,
            title: row.title || row.url,
            snippet: (row.snippet || "").slice(0, 600),
            publishedAt: row.publishedAt,
            provider: args.provider.name,
            query: query.q,
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed";
        errors.push(`${query.q}: ${message}`);
        return [];
      } finally {
        clearTimeout(timer);
        args.signal?.removeEventListener("abort", onAbort);
      }
    }),
  );
  return {
    hits: mergeHits(batches.flat(), args.keywords, args.maxHits),
    errors,
  };
}
