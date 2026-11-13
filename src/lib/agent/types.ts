/** Shared shapes. No I/O, so the UI and the tests can both import them. */

export type Role = "user" | "assistant";

export type Intent = "chat" | "recall" | "reverify" | "research";

export type Citation = {
  n: number;
  url: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
  retrievedAt: string;
  query: string;
  provider: string;
};

export type RouteNote = {
  intent: Intent;
  reason: string;
  /** Days we looked at, primary reading first. */
  dates: string[];
  /** The day the note actually came from, when one did. */
  matchedDate: string | null;
  queries: string[];
  search: "live" | "off" | "failed";
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: number;
  citations?: Citation[];
  route?: RouteNote;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Seeded history, so a reviewer can try the sample prompts. */
  sample?: boolean;
};

export type Turn = {
  user: StoredMessage;
  assistant: StoredMessage | null;
};

export type ResolvedMention = {
  phrase: string;
  index: number;
  /** "since then" has no calendar day of its own. */
  kind: "day" | "since-then";
  /** True for "since Monday": the day is the memory anchor and the start of the freshness window. */
  since: boolean;
  startMs: number;
  endMs: number;
  label: string;
  alternates: Array<{ label: string; startMs: number; endMs: number }>;
};

export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
  provider: string;
  query: string;
};

export type PlannedQuery = {
  q: string;
  reason: string;
};

export type AgentEvent =
  | { type: "status"; data: { phase: "memory" | "search" | "writing"; detail: string } }
  | { type: "meta"; data: { conversationId: string } & RouteNote }
  | { type: "citations"; data: { citations: Citation[] } }
  | { type: "token"; data: { text: string } }
  | {
      type: "done";
      data: { conversationId: string; title: string; userId: string; assistantId: string };
    }
  | { type: "error"; data: { message: string } };
