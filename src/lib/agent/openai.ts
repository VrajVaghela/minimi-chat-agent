/**
 * OpenAI-compatible chat completions.
 *
 * One client covers OpenAI, Groq, OpenRouter, and a local server that speaks
 * the same protocol. Native Anthropic and Gemini adapters were rejected:
 * a second wire format is a second place for the tool loop to go wrong.
 */

import type { ChatMessage } from "./prompt";
import { WEB_SEARCH_TOOL } from "./tools";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ModelRequest = {
  messages: ChatMessage[];
  tools: boolean;
  signal?: AbortSignal;
};

export type ModelDelta = { type: "text"; text: string };

export interface ModelClient {
  complete(req: ModelRequest): Promise<{ content: string; toolCalls: ToolCall[] }>;
  stream(req: ModelRequest): AsyncIterable<ModelDelta>;
}

export function openAIModel(opts: { apiKey: string; baseUrl: string; model: string }): ModelClient {
  return {
    async complete(req) {
      const json = await post(opts, req, false);
      const message = json.choices?.[0]?.message ?? {};
      const toolCalls = (message.tool_calls ?? []).map((call) => ({
        id: call.id ?? crypto.randomUUID(),
        name: call.function?.name ?? "",
        arguments: call.function?.arguments ?? "",
      }));
      return { content: message.content ?? "", toolCalls };
    },
    async *stream(req) {
      const response = await send(opts, req, true);
      if (!response.body) throw new Error("The model provider returned an empty body.");
      yield* readStream(response.body);
    },
  };
}

type WireToolCall = { id?: string; function?: { name?: string; arguments?: string } };
type WireMessage = { content?: string | null; tool_calls?: WireToolCall[] };
type WireChunk = { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
type WireResponse = { choices?: Array<{ message?: WireMessage }> };

async function post(
  opts: { apiKey: string; baseUrl: string; model: string },
  req: ModelRequest,
  stream: boolean,
): Promise<WireResponse> {
  const response = await send(opts, req, stream);
  return (await response.json()) as WireResponse;
}

async function send(
  opts: { apiKey: string; baseUrl: string; model: string },
  req: ModelRequest,
  stream: boolean,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: 0.2,
    max_tokens: 900,
    stream,
    messages: req.messages.map(toWire),
  };
  if (req.tools) {
    body.tools = [WEB_SEARCH_TOOL];
    body.tool_choice = "auto";
  }
  const response = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(cleanProviderError(response.status, detail));
  }
  return response;
}

function toWire(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.tool_calls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.tool_calls,
    };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.tool_call_id };
  }
  return { role: message.role, content: message.content };
}

async function* readStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ModelDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: WireChunk;
      try {
        json = JSON.parse(data) as WireChunk;
      } catch {
        continue;
      }
      const text = json.choices?.[0]?.delta?.content;
      if (text) yield { type: "text", text };
    }
  }
}

export function cleanProviderError(status: number, body: string): string {
  const clipped = body.replace(/sk-[A-Za-z0-9_-]+/g, "sk-…").slice(0, 240);
  if (status === 401) return "The model API key was rejected.";
  if (status === 404) return "That model name was not found at this API base URL.";
  if (status === 429) return "The model provider rate-limited the request. Try again in a moment.";
  return `The model provider returned ${status}. ${clipped}`.trim();
}
