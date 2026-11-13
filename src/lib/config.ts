export type AppConfig = {
  timeZone: string;
  model: {
    mode: "openai" | "off";
    apiKey: string | null;
    baseUrl: string;
    model: string;
  };
  search: {
    provider: "tavily" | "brave" | "mock";
    tavilyKey: string | null;
    braveKey: string | null;
  };
};

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const timeZone = env.AGENT_TIMEZONE?.trim() || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw new Error(`AGENT_TIMEZONE "${timeZone}" is not a valid IANA timezone.`);
  }

  const apiKey = blank(env.OPENAI_API_KEY);
  const tavilyKey = blank(env.TAVILY_API_KEY);
  const braveKey = blank(env.BRAVE_SEARCH_API_KEY);
  const forced = (env.SEARCH_PROVIDER || "auto").trim().toLowerCase();

  let provider: AppConfig["search"]["provider"];
  if (forced === "tavily" || forced === "brave" || forced === "mock") {
    provider = forced;
  } else {
    provider = tavilyKey ? "tavily" : braveKey ? "brave" : "mock";
  }

  return {
    timeZone,
    model: {
      mode: apiKey ? "openai" : "off",
      apiKey,
      baseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    },
    search: { provider, tavilyKey, braveKey },
  };
}

export function dataFile(): string {
  return process.env.SINCE_DATA_FILE?.trim() || `${process.cwd()}/data/since.json`;
}
