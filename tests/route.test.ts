import { describe, expect, it } from "vitest";
import { resolveMentions } from "../src/lib/agent/dates";
import { buildRoute } from "../src/lib/agent/intent";
import { planQueries } from "../src/lib/agent/plan";
import { extractEntities } from "../src/lib/agent/text";
import { WEB_SEARCH_TOOL } from "../src/lib/agent/tools";

const TZ = "Asia/Kolkata";
const NOW = Date.parse("2026-11-13T04:30:00.000Z");

function route(message: string) {
  return buildRoute(message, resolveMentions(message, NOW, TZ), NOW, TZ);
}

describe("routing and query plans", () => {
  it("exposes exactly one tool, web_search", () => {
    expect(WEB_SEARCH_TOOL.function.name).toBe("web_search");
    expect(WEB_SEARCH_TOOL.type).toBe("function");
  });

  it("pulls a shortlist out of a comma-separated sentence", () => {
    expect(
      extractEntities("Shortlist for the 20-person sales team: HubSpot, Attio, Pipedrive, Close, and Folk."),
    ).toEqual(["HubSpot", "Attio", "Pipedrive", "Close", "Folk"]);
    expect(extractEntities("I quoted Neon Launch at $19, Supabase Pro at $25, and a small RDS instance.")).toEqual([
      "Neon",
      "Supabase",
      "RDS",
    ]);
  });

  it("routes the three sample prompts", () => {
    const crm =
      "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?";
    const november = "What did I ask you on 3 November? Is your answer still correct today?";
    const postgres = "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?";
    const memoryOnly = "What did I ask you on 3 November?";

    expect(route(crm).intent).toBe("reverify");
    expect(route(crm).needsSearch).toBe(true);
    expect(route(crm).windows[0].label).toBe("Monday, 9 November 2026");
    expect(route(crm).sinceLabel).toBe("Monday, 9 November 2026");

    expect(route(november).intent).toBe("reverify");
    expect(route(november).windows.map((window) => window.label)).toEqual(["Tuesday, 3 November 2026"]);
    expect(route(november).windows.some((window) => window.label.includes("13 November"))).toBe(false);

    expect(route(postgres).intent).toBe("reverify");
    expect(route(postgres).windows[0].label).toBe("Tuesday, 10 November 2026");
    expect(route(postgres).windows[0].alternates[0].label).toBe("Tuesday, 3 November 2026");

    expect(route(memoryOnly).intent).toBe("recall");
    expect(route(memoryOnly).needsSearch).toBe(false);
  });

  it("does not search a thank-you", () => {
    expect(route("thanks!").intent).toBe("chat");
    expect(route("thanks!").needsSearch).toBe(false);
    expect(planQueries({ message: "thanks!", route: route("thanks!"), recalledText: "", now: NOW, timeZone: TZ })).toEqual(
      [],
    );
  });

  it("plans one query per remembered product", () => {
    const message =
      "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?";
    const planned = planQueries({
      message,
      route: route(message),
      recalledText: "Shortlist: HubSpot, Attio, Pipedrive, Close, and Folk.",
      now: NOW,
      timeZone: TZ,
    });
    expect(planned.map((query) => query.reason)).toEqual([
      "Recheck HubSpot",
      "Recheck Attio",
      "Recheck Pipedrive",
      "Recheck Close",
      "Recheck Folk",
    ]);
    expect(planned[0].q).toContain("since Monday, 9 November 2026");
  });
});
