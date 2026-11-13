import type { AppConfig } from "../../config";
import { braveProvider } from "./brave";
import { offlineProvider, type SearchProvider } from "./provider";
import { tavilyProvider } from "./tavily";

export function createSearchProvider(config: AppConfig): SearchProvider {
  if (config.search.provider === "tavily") {
    if (!config.search.tavilyKey) {
      return offlineProvider("tavily", "SEARCH_PROVIDER is tavily, but TAVILY_API_KEY is empty.");
    }
    return tavilyProvider(config.search.tavilyKey);
  }
  if (config.search.provider === "brave") {
    if (!config.search.braveKey) {
      return offlineProvider("brave", "SEARCH_PROVIDER is brave, but BRAVE_SEARCH_API_KEY is empty.");
    }
    return braveProvider(config.search.braveKey);
  }
  return offlineProvider("mock", "No search API key is set.");
}
