import { openAIModel, type ModelClient } from "./agent/openai";
import { MemoryStore } from "./agent/memory";
import { createSearchProvider } from "./agent/search/create";
import { dataFile, loadConfig } from "./config";

/** What a request needs. Kept out of the client bundle: it touches the filesystem. */
export function runtimeBits() {
  const config = loadConfig();
  const store = MemoryStore.openFile(dataFile());
  const search = createSearchProvider(config);
  const model: ModelClient | null =
    config.model.mode === "openai" && config.model.apiKey
      ? openAIModel({
          apiKey: config.model.apiKey,
          baseUrl: config.model.baseUrl,
          model: config.model.model,
        })
      : null;
  return { config, store, search, model };
}
