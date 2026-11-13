export type RawHit = {
  url: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
};

export type SearchProvider = {
  name: string;
  /** False when these results are not from the live web. */
  live: boolean;
  note?: string;
  search(query: string, opts: { limit: number; signal?: AbortSignal }): Promise<RawHit[]>;
};

export function offlineProvider(name: string, note: string): SearchProvider {
  return {
    name,
    live: false,
    note,
    async search() {
      return [];
    },
  };
}
