import type { SearchProvider } from "./provider";

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
};

/**
 * Tavily is the default live provider: it is built for agents and returns a
 * cleaned passage instead of a raw HTML snippet. https://app.tavily.com
 */
export function tavilyProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    live: true,
    async search(query, opts) {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        signal: opts.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: opts.limit,
          search_depth: "basic",
          include_answer: false,
          topic: "general",
        }),
      });
      if (!response.ok) {
        throw new Error(`Tavily returned ${response.status}`);
      }
      const json = (await response.json()) as { results?: TavilyResult[] };
      return (json.results ?? [])
        .filter((row) => row.url)
        .map((row) => ({
          url: row.url as string,
          title: row.title ?? row.url ?? "Untitled",
          snippet: row.content ?? "",
          publishedAt: row.published_date ?? null,
        }));
    },
  };
}
