import type { SearchHit } from "../types";

/** Drop tracking params so the same article from two queries counts once. */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "fbclid" || key === "gclid") {
        parsed.searchParams.delete(key);
      }
    }
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function mergeHits(hits: SearchHit[], keywords: string[], maxHits: number): SearchHit[] {
  const scored = new Map<string, { hit: SearchHit; score: number }>();
  for (const hit of hits) {
    const url = canonicalUrl(hit.url);
    const text = `${hit.title} ${hit.snippet}`.toLowerCase();
    let score = 1;
    for (const keyword of keywords) {
      if (keyword.length > 2 && text.includes(keyword.toLowerCase())) score += 2;
    }
    if (hit.publishedAt) score += 1;
    const prev = scored.get(url);
    if (!prev) {
      scored.set(url, { hit: { ...hit, url }, score });
    } else {
      prev.score += score;
      if (hit.snippet.length > prev.hit.snippet.length) prev.hit = { ...hit, url };
    }
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxHits)
    .map((row) => row.hit);
}
