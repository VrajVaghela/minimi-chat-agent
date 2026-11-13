"use client";

import { addZonedDays, formatDayLabel, startOfZonedDay } from "@/lib/agent/clock";
import type { Citation, RouteNote } from "@/lib/agent/types";
import { ArrowUp, Menu, Plus, Trash, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./markdown";

type Health = {
  timezone: string;
  model: { enabled: boolean; name: string | null };
  search: { provider: string; live: boolean; note: string | null };
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  sample?: boolean;
  turns: number;
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  route?: RouteNote;
  pending?: boolean;
};

const EXAMPLES = [
  "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?",
  "What did I ask you on 3 November? Is your answer still correct today?",
  "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
];

export function ChatApp() {
  const [health, setHealth] = useState<Health | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const skipLoad = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const timeZone = health?.timezone ?? "Asia/Kolkata";

  async function loadConversations() {
    const response = await fetch("/api/conversations");
    if (!response.ok) throw new Error("Could not load conversations.");
    const body = (await response.json()) as { conversations: Conversation[] };
    setConversations(body.conversations);
  }

  useEffect(() => {
    let cancel = false;
    Promise.all([fetch("/api/health").then((response) => response.json()), fetch("/api/conversations").then((response) => response.json())])
      .then(([healthBody, listBody]) => {
        if (cancel) return;
        setHealth(healthBody as Health);
        setConversations((listBody as { conversations: Conversation[] }).conversations ?? []);
      })
      .catch(() => {
        if (!cancel) setError("Could not load conversations.");
      })
      .finally(() => {
        if (!cancel) setBooting(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (skipLoad.current) {
      skipLoad.current = false;
      return;
    }
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancel = false;
    setLoadingThread(true);
    setError(null);
    fetch(`/api/conversations/${activeId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("That conversation could not be opened.");
        return (await response.json()) as { messages: UiMessage[] };
      })
      .then((body) => {
        if (!cancel) setMessages(body.messages);
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "That conversation could not be opened.");
      })
      .finally(() => {
        if (!cancel) setLoadingThread(false);
      });
    return () => {
      cancel = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (!stick.current) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const groups = useMemo(() => groupConversations(conversations, timeZone), [conversations, timeZone]);
  const active = conversations.find((conversation) => conversation.id === activeId);
  const showEmpty = !loadingThread && messages.length === 0 && !sending;

  function openConversation(id: string) {
    conversationId.current = id;
    setActiveId(id);
    setNavOpen(false);
    setError(null);
  }

  function newChat() {
    conversationId.current = null;
    setActiveId(null);
    setMessages([]);
    setError(null);
    setNavOpen(false);
    box.current?.focus();
  }

  async function removeConversation(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not delete that conversation.");
      return;
    }
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
    if (conversationId.current === id) newChat();
  }

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || sending) return;
    setDraft("");
    setError(null);
    setSending(true);
    setStatus("Reading the question");
    stick.current = true;
    const userTemp = crypto.randomUUID();
    const assistantTemp = crypto.randomUUID();
    let wrote = false;
    setMessages((current) => [
      ...current,
      { id: userTemp, role: "user", content: message },
      { id: assistantTemp, role: "assistant", content: "", pending: true },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: conversationId.current }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "The request failed.");
      }
      await readSSE(response, (event, data) => {
        if (event === "status") {
          const detail = (data as { detail?: string }).detail;
          if (detail) setStatus(detail);
        }
        if (event === "meta") {
          const meta = data as { conversationId: string } & RouteNote;
          conversationId.current = meta.conversationId;
          setMessages((current) => current.map((item) => (item.id === assistantTemp ? { ...item, route: meta } : item)));
        }
        if (event === "citations") {
          const citations = (data as { citations: Citation[] }).citations;
          setMessages((current) => current.map((item) => (item.id === assistantTemp ? { ...item, citations } : item)));
        }
        if (event === "token") {
          wrote = true;
          const chunk = (data as { text: string }).text;
          setMessages((current) =>
            current.map((item) => (item.id === assistantTemp ? { ...item, content: item.content + chunk } : item)),
          );
        }
        if (event === "done") {
          const done = data as { conversationId: string };
          conversationId.current = done.conversationId;
          skipLoad.current = true;
          setActiveId(done.conversationId);
          void loadConversations().catch(() => setError("The reply was saved, but the list did not refresh."));
        }
        if (event === "error") {
          const text = (data as { message?: string }).message || "Something went wrong.";
          setError(text);
        }
      });
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "The request failed.";
      setError(text);
      if (!wrote) {
        setDraft(message);
        setMessages((current) => current.filter((item) => item.id !== userTemp && item.id !== assistantTemp));
      }
    } finally {
      setSending(false);
      setStatus(null);
      setMessages((current) => current.map((item) => (item.id === assistantTemp ? { ...item, pending: false } : item)));
      box.current?.focus();
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    const el = box.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {navOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-[#1e1a15]/30 md:hidden"
          aria-label="Close conversations"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        className={`drawer fixed inset-y-0 left-0 z-30 flex w-[18.5rem] flex-col border-r border-line bg-sidebar transition-transform duration-200 md:static md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <p className="font-serif text-[1.7rem] leading-none tracking-[-0.03em]">Since</p>
          <button type="button" className="md:hidden" aria-label="Close conversations" onClick={() => setNavOpen(false)}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm hover:border-accent"
          >
            <Plus size={16} strokeWidth={1.75} />
            New chat
          </button>
        </div>
        <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {booting ? <p className="px-2 py-2 text-sm text-muted">Loading notes.</p> : null}
          {!booting && conversations.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted">No conversations yet.</p>
          ) : null}
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-2 py-1 text-xs text-muted">{group.label}</p>
              <ul>
                {group.items.map((conversation) => {
                  const selected = conversation.id === activeId;
                  return (
                    <li key={conversation.id}>
                      <div
                        className={`group flex items-center gap-1 rounded-md pr-1 ${selected ? "bg-surface" : "hover:bg-surface/70"}`}
                      >
                        <button
                          type="button"
                          onClick={() => openConversation(conversation.id)}
                          aria-current={selected ? "true" : undefined}
                          className="flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1.5 text-left text-sm"
                        >
                          <span className="truncate">{conversation.title}</span>
                          {conversation.sample ? <span className="shrink-0 text-xs text-muted">Sample</span> : null}
                        </button>
                        <button
                          type="button"
                          aria-label={confirmDelete === conversation.id ? "Confirm delete" : `Delete ${conversation.title}`}
                          onClick={() => void removeConversation(conversation.id)}
                          className="shrink-0 rounded px-1.5 py-1 text-xs text-muted opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        >
                          {confirmDelete === conversation.id ? "Delete" : <Trash size={14} strokeWidth={1.75} />}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <footer className="border-t border-line px-4 py-3 text-sm leading-5 text-muted">
          <p>{health?.model.enabled ? health.model.name : "No model key"}</p>
          <p>{health?.search.live ? `${health.search.provider} search` : "Search off"}</p>
          <p>Times in {timeZone.replaceAll("_", " ")}</p>
        </footer>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-3 py-3 md:px-6">
          <button type="button" className="md:hidden" aria-label="Open conversations" onClick={() => setNavOpen(true)}>
            <Menu size={18} strokeWidth={1.75} />
          </button>
          <p className="truncate text-sm text-muted">{active?.title ?? "New chat"}</p>
        </header>

        <div
          ref={scroller}
          onScroll={() => {
            const el = scroller.current;
            if (!el) return;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-8 px-4 py-8 md:px-0">
            {showEmpty ? (
              <div className="pt-8">
                <h1 className="font-serif text-[2rem] leading-[1.15] tracking-[-0.03em] text-balance">
                  Ask something you may want to check again later.
                </h1>
                <p className="mt-3 max-w-[38rem] text-muted">
                  Since keeps the question, the answer, and the day. Come back and ask whether it is still true.
                  {health && !health.search.live ? " Web search is off until a key is set, so it will say so instead of guessing a price." : ""}
                </p>
                <ul className="mt-8 border-t border-line">
                  {EXAMPLES.map((example) => (
                    <li key={example} className="border-b border-line">
                      <button
                        type="button"
                        onClick={() => void send(example)}
                        className="w-full py-3 text-left text-[0.98rem] leading-6 hover:text-accent"
                      >
                        {example}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {loadingThread ? <p className="text-sm text-muted">Opening this conversation.</p> : null}

            {messages.map((message) => {
              if (message.role === "assistant" && !message.content && message.pending) return null;
              if (message.role === "user") {
                return (
                  <p
                    key={message.id}
                    className="ml-auto w-fit max-w-[32rem] rounded-2xl rounded-br-md bg-sidebar px-4 py-2.5 text-[1.02rem] leading-7"
                  >
                    {message.content}
                  </p>
                );
              }
              return (
                <article key={message.id} className="max-w-[38rem]">
                  <Markdown
                    text={message.content}
                    onCite={(n) => {
                      document.getElementById(`source-${message.id}-${n}`)?.scrollIntoView({ block: "nearest" });
                    }}
                  />
                  {message.route ? <RouteLine route={message.route} /> : null}
                  {message.citations && message.citations.length > 0 ? (
                    <ol className="mt-4 flex flex-col gap-3">
                      {message.citations.map((citation) => (
                        <li id={`source-${message.id}-${citation.n}`} key={citation.url} className="text-sm">
                          <a href={citation.url} target="_blank" rel="noreferrer" className="text-accent underline-offset-[0.18em] hover:underline">
                            <span className="tabular-nums">{citation.n}</span>
                            <span className="text-muted"> {hostOf(citation.url)} · </span>
                            {citation.title}
                          </a>
                          <p className="mt-0.5 line-clamp-2 text-muted">{citation.snippet}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <form
          className="border-t border-line bg-background"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <div className="mx-auto w-full max-w-[40rem] px-4 py-3 md:px-0">
            {status ? (
              <p className="mb-2 flex items-center gap-2 text-sm text-muted" aria-live="polite">
                <span className="status-dot inline-block size-1.5 rounded-full bg-accent" />
                {status}
              </p>
            ) : null}
            {error ? (
              <p className="mb-2 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow)]">
              <label className="sr-only" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                ref={box}
                rows={1}
                value={draft}
                disabled={sending}
                placeholder="Ask, or ask whether it is still true"
                className="max-h-44 min-h-10 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted disabled:opacity-60"
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={sending || !draft.trim()}
                className="mb-0.5 grid size-9 place-items-center rounded-full bg-accent text-surface disabled:opacity-40"
              >
                <ArrowUp size={18} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

function RouteLine({ route }: { route: RouteNote }) {
  const date = route.matchedDate && route.matchedDate !== "this conversation" ? route.matchedDate : route.dates[0];
  const search =
    route.search === "live"
      ? `searched ${route.queries.length || ""}`.trim()
      : route.search === "failed"
        ? "search came back empty"
        : route.intent === "research" || route.intent === "reverify"
          ? "search off"
          : "no search";
  const summary = [date, search].filter(Boolean).join(" · ");
  if (!summary && route.queries.length === 0) return null;
  return (
    <details className="mt-3 text-sm text-muted">
      <summary className="cursor-pointer">{summary || "What I looked at"}</summary>
      <p className="mt-2">{route.reason}</p>
      {route.queries.length > 0 ? (
        <ul className="mt-2 list-disc pl-5">
          {route.queries.map((query, index) => (
            <li key={`${query}-${index}`}>{query}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function groupConversations(conversations: Conversation[], timeZone: string) {
  const now = Date.now();
  const today = startOfZonedDay(now, timeZone);
  const yesterday = addZonedDays(today, -1, timeZone);
  const groups = new Map<string, { label: string; items: Conversation[] }>();
  for (const conversation of conversations) {
    const start = startOfZonedDay(conversation.updatedAt, timeZone);
    const label = start === today ? "Today" : start === yesterday ? "Yesterday" : formatDayLabel(conversation.updatedAt, timeZone);
    const group = groups.get(label) ?? { label, items: [] };
    group.items.push(conversation);
    groups.set(label, group);
  }
  return [...groups.values()];
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function readSSE(response: Response, onEvent: (event: string, data: unknown) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The response had no body.");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      onEvent(event, JSON.parse(dataLines.join("\n")));
    }
  }
}
