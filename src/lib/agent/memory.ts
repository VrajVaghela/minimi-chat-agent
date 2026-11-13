/**
 * Transcript store.
 *
 * One person, on one machine. A JSON file is enough, and it keeps `npm install`
 * free of native builds. `node:sqlite` was rejected because it is still
 * experimental and needs Node 22. The recall operation is a scan over that
 * person's own history, which stays small.
 *
 * Recall is not a tool the model can forget to call. The orchestrator runs it
 * on every turn that names a day or asks what was said.
 */

import fs from "node:fs";
import path from "node:path";
import type { Conversation, StoredMessage, Turn } from "./types";

export type Snapshot = {
  conversations: Conversation[];
  messages: StoredMessage[];
};

export type DayWindow = {
  label: string;
  startMs: number;
  endMs: number;
  alternates: Array<{ label: string; startMs: number; endMs: number }>;
};

export type RecallResult = {
  turns: Turn[];
  matchedLabel: string | null;
  checkedLabels: string[];
  related: Turn[];
};

function pairTurns(messages: StoredMessage[]): Turn[] {
  const ordered = [...messages].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const byConversation = new Map<string, StoredMessage[]>();
  for (const message of ordered) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }
  const turns: Turn[] = [];
  for (const list of byConversation.values()) {
    for (let i = 0; i < list.length; i++) {
      const message = list[i];
      if (message.role !== "user") continue;
      const next = list[i + 1];
      turns.push({
        user: message,
        assistant: next && next.role === "assistant" ? next : null,
      });
    }
  }
  turns.sort((a, b) => a.user.createdAt - b.user.createdAt);
  return turns;
}

function inWindow(ms: number, start: number, end: number): boolean {
  return ms >= start && ms < end;
}

function overlap(turn: Turn, words: string[]): number {
  if (!words.length) return 0;
  const text = `${turn.user.content} ${turn.assistant?.content ?? ""}`.toLowerCase();
  return words.reduce((count, word) => count + (text.includes(word.toLowerCase()) ? 1 : 0), 0);
}

export class MemoryStore {
  constructor(
    private data: Snapshot,
    private persist: (() => void) | null = null,
  ) {}

  static empty(): MemoryStore {
    return new MemoryStore({ conversations: [], messages: [] });
  }

  static openFile(file: string): MemoryStore {
    let data: Snapshot = { conversations: [], messages: [] };
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8").trim();
      if (raw) {
        const parsed = JSON.parse(raw) as Snapshot;
        if (!Array.isArray(parsed.conversations) || !Array.isArray(parsed.messages)) {
          throw new Error(`Memory file ${file} is not a Since transcript.`);
        }
        data = parsed;
      }
    }
    return new MemoryStore(data, () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    });
  }

  private save() {
    this.persist?.();
  }

  listConversations(): Array<Conversation & { turns: number }> {
    return [...this.data.conversations]
      .map((conversation) => ({
        ...conversation,
        turns: this.data.messages.filter(
          (message) => message.conversationId === conversation.id && message.role === "user",
        ).length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getConversation(id: string): Conversation | null {
    return this.data.conversations.find((conversation) => conversation.id === id) ?? null;
  }

  getMessages(id: string): StoredMessage[] {
    return this.data.messages
      .filter((message) => message.conversationId === id)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  createConversation(at: number, title = "New chat", sample = false): Conversation {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title,
      createdAt: at,
      updatedAt: at,
      ...(sample ? { sample: true } : {}),
    };
    this.data.conversations.push(conversation);
    this.save();
    return conversation;
  }

  deleteConversation(id: string) {
    this.data.conversations = this.data.conversations.filter((conversation) => conversation.id !== id);
    this.data.messages = this.data.messages.filter((message) => message.conversationId !== id);
    this.save();
  }

  deleteSamples() {
    const ids = new Set(
      this.data.conversations.filter((conversation) => conversation.sample).map((conversation) => conversation.id),
    );
    this.data.conversations = this.data.conversations.filter((conversation) => !ids.has(conversation.id));
    this.data.messages = this.data.messages.filter((message) => !ids.has(message.conversationId));
    this.save();
  }

  renameIfUntitled(id: string, title: string) {
    const conversation = this.data.conversations.find((item) => item.id === id);
    if (!conversation || conversation.title !== "New chat") return;
    conversation.title = title;
    this.save();
  }

  appendAll(messages: StoredMessage[]) {
    for (const message of messages) {
      this.data.messages.push(message);
      const conversation = this.data.conversations.find((item) => item.id === message.conversationId);
      if (conversation) conversation.updatedAt = message.createdAt;
    }
    this.save();
  }

  recentTurns(conversationId: string | undefined, limit: number): Turn[] {
    const messages = conversationId
      ? this.data.messages.filter((message) => message.conversationId === conversationId)
      : this.data.messages;
    return pairTurns(messages).slice(-limit);
  }

  /**
   * `preferDay` means the user pointed at a day ("any of them", "what did I ask")
   * and an unmatched note on that day is still the right context.
   * A named topic that misses ("Postgres" on a day we only talked about CRM)
   * returns nothing for that day, so the alternate reading or another day can surface.
   */
  recall(args: { windows: DayWindow[]; keywords: string[]; limit: number; preferDay: boolean }): RecallResult {
    const all = pairTurns(this.data.messages);
    const checkedLabels: string[] = [];
    const chosen: Turn[] = [];
    const matched: string[] = [];

    const pick = (label: string, start: number, end: number): Turn[] => {
      checkedLabels.push(label);
      const inside = all.filter((turn) => inWindow(turn.user.createdAt, start, end));
      if (!inside.length) return [];
      if (args.keywords.length) {
        const scored = inside.filter((turn) => overlap(turn, args.keywords) > 0);
        if (scored.length) return scored;
      }
      if (!args.keywords.length || args.preferDay) return inside;
      return [];
    };

    for (const window of args.windows) {
      const primary = pick(window.label, window.startMs, window.endMs);
      if (primary.length) {
        chosen.push(...primary);
        matched.push(window.label);
        continue;
      }
      for (const alternate of window.alternates) {
        const found = pick(alternate.label, alternate.startMs, alternate.endMs);
        if (found.length) {
          chosen.push(...found);
          matched.push(alternate.label);
          break;
        }
      }
    }

    const covered = (turn: Turn) =>
      args.windows.some(
        (window) =>
          inWindow(turn.user.createdAt, window.startMs, window.endMs) ||
          window.alternates.some((alternate) =>
            inWindow(turn.user.createdAt, alternate.startMs, alternate.endMs),
          ),
      );

    const related =
      chosen.length || args.keywords.length === 0
        ? []
        : all
            .filter((turn) => !covered(turn) && overlap(turn, args.keywords) > 0)
            .sort((a, b) => b.user.createdAt - a.user.createdAt)
            .slice(0, 3);

    return {
      turns: chosen.slice(0, args.limit),
      matchedLabel: matched.length ? matched.join("; ") : null,
      checkedLabels,
      related,
    };
  }
}
