import type { SearchProvider } from "./provider";

type BraveResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

/** Brave Search API. https://api-dashboard.search.brave.com/app/keys */
export function braveProvider(apiKey: string): SearchProvider {
  return {
    name: "brave",
    live: true,
    async search(query, opts) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(opts.limit));
      const response = await fetch(url, {
        signal: opts.signal,
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
      });
      if (!response.ok) {
        throw new Error(`Brave returned ${response.status}`);
      }
      const json = (await response.json()) as { web?: { results?: BraveResult[] } };
      return (json.web?.results ?? [])
        .filter((row) => row.url)
        .map((row) => ({
          url: row.url as string,
          title: row.title ?? row.url ?? "Untitled",
          snippet: row.description ?? "",
          publishedAt: row.age ?? null,
        }));
    },
  };
}
