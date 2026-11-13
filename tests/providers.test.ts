import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config";
import { cleanProviderError, openAIModel } from "../src/lib/agent/openai";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("providers and config", () => {
  it("picks a search provider from whichever key is present", () => {
    expect(loadConfig({}).search.provider).toBe("mock");
    expect(loadConfig({ TAVILY_API_KEY: "tvly" }).search.provider).toBe("tavily");
    expect(loadConfig({ BRAVE_SEARCH_API_KEY: "brave" }).search.provider).toBe("brave");
    expect(loadConfig({ SEARCH_PROVIDER: "brave", TAVILY_API_KEY: "tvly" }).search.provider).toBe("brave");
    expect(loadConfig({ OPENAI_API_KEY: "sk-live" }).model).toMatchObject({
      mode: "openai",
      model: "gpt-4.1-mini",
    });
    expect(loadConfig({}).model.mode).toBe("off");
    expect(() => loadConfig({ AGENT_TIMEZONE: "Not/AZone" })).toThrow(/IANA/);
  });

  it("offers the model only web_search and hides secrets in errors", async () => {
    let body: { tools?: Array<{ function: { name: string } }> } = {};
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init && "body" in init ? init.body : "{}"));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    };
    const model = openAIModel({ apiKey: "sk-test", baseUrl: "https://example.com/v1", model: "gpt-4.1-mini" });
    const result = await model.complete({
      messages: [{ role: "user", content: "Hello" }],
      tools: true,
    });
    expect(result.content).toBe("ok");
    expect(body.tools?.map((tool) => tool.function.name)).toEqual(["web_search"]);
    expect(cleanProviderError(401, "bad key sk-abcSECRET")).toBe("The model API key was rejected.");
    expect(cleanProviderError(500, "boom sk-abcSECRET")).not.toContain("sk-abcSECRET");
  });
});
