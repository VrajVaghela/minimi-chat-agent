/**
 * The only tool the model is allowed to call.
 *
 * Memory, dates, and the decision to search are orchestrator work. Putting
 * them behind tools would let the model skip them. Web search is the one
 * thing that has to hit the network, so it is the one tool.
 */
export const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the public web for current facts, prices, and product changes. Do not use this to recall earlier conversations; those are already in the prompt. One specific query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A concrete search query, including the product name and the year when it matters.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

export function parseSearchQuery(args: string): string | null {
  try {
    const parsed = JSON.parse(args) as { query?: unknown };
    if (typeof parsed.query === "string" && parsed.query.trim()) return parsed.query.trim().slice(0, 180);
  } catch {
    return null;
  }
  return null;
}
