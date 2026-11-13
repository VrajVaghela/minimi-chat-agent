import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zonedTimeToUtc } from "../src/lib/agent/clock";
import { MemoryStore } from "../src/lib/agent/memory";
import type { StoredMessage } from "../src/lib/agent/types";

const TZ = "Asia/Kolkata";

function at(year: number, month: number, day: number, hour = 10) {
  return zonedTimeToUtc(year, month, day, hour, 0, 0, TZ);
}

function turn(store: MemoryStore, conversationId: string, when: number, user: string, assistant: string) {
  const messages: StoredMessage[] = [
    { id: crypto.randomUUID(), conversationId, role: "user", content: user, createdAt: when },
    {
      id: crypto.randomUUID(),
      conversationId,
      role: "assistant",
      content: assistant,
      createdAt: when + 1,
    },
  ];
  store.appendAll(messages);
}

describe("memory recall", () => {
  it("returns the question and answer from a named day, across conversations", () => {
    const store = MemoryStore.empty();
    const older = store.createConversation(at(2026, 11, 3), "Linear");
    const newer = store.createConversation(at(2026, 11, 10), "Postgres");
    turn(store, older.id, at(2026, 11, 3, 11), "Is Linear's free tier enough?", "Standard is $10.");
    turn(store, newer.id, at(2026, 11, 10, 16), "Compare Neon and RDS.", "Neon Launch is $19.");

    const found = store.recall({
      windows: [
        {
          label: "3 November 2026",
          startMs: at(2026, 11, 3, 0),
          endMs: at(2026, 11, 4, 0),
          alternates: [],
        },
      ],
      keywords: [],
      limit: 6,
      preferDay: true,
    });

    expect(found.turns).toHaveLength(1);
    expect(found.turns[0].user.content).toContain("Linear");
    expect(found.turns[0].assistant?.content).toContain("$10");
    expect(found.turns[0].user.conversationId).toBe(older.id);
    expect(found.matchedLabel).toBe("3 November 2026");
  });

  it("does not include the next day's messages", () => {
    const store = MemoryStore.empty();
    const conversation = store.createConversation(at(2026, 11, 2));
    turn(store, conversation.id, at(2026, 11, 2, 23), "late note", "still the 2nd");
    const found = store.recall({
      windows: [
        {
          label: "3 November",
          startMs: at(2026, 11, 3, 0),
          endMs: at(2026, 11, 4, 0),
          alternates: [],
        },
      ],
      keywords: [],
      limit: 6,
      preferDay: true,
    });
    expect(found.turns).toHaveLength(0);
    expect(found.checkedLabels).toEqual(["3 November"]);
  });

  it("prefers the topic on that day, and falls through to the alternate reading", () => {
    const store = MemoryStore.empty();
    const conversation = store.createConversation(at(2026, 11, 3));
    turn(store, conversation.id, at(2026, 11, 10, 9), "CRM shortlist", "HubSpot only.");
    turn(store, conversation.id, at(2026, 11, 3, 9), "Postgres hosting", "Neon is $19.");

    const missed = store.recall({
      windows: [
        {
          label: "Tuesday 10 November",
          startMs: at(2026, 11, 10, 0),
          endMs: at(2026, 11, 11, 0),
          alternates: [
            {
              label: "Tuesday 3 November",
              startMs: at(2026, 11, 3, 0),
              endMs: at(2026, 11, 4, 0),
            },
          ],
        },
      ],
      keywords: ["postgres"],
      limit: 6,
      preferDay: false,
    });
    expect(missed.matchedLabel).toBe("Tuesday 3 November");
    expect(missed.turns[0].user.content).toContain("Postgres");
    expect(missed.checkedLabels).toEqual(["Tuesday 10 November", "Tuesday 3 November"]);
  });

  it("keeps an unmatched day when the user pointed at it with 'them'", () => {
    const store = MemoryStore.empty();
    const conversation = store.createConversation(at(2026, 11, 9));
    turn(store, conversation.id, at(2026, 11, 9, 10), "HubSpot, Attio, and Close.", "Noted.");
    const found = store.recall({
      windows: [
        {
          label: "Monday",
          startMs: at(2026, 11, 9, 0),
          endMs: at(2026, 11, 10, 0),
          alternates: [],
        },
      ],
      keywords: ["crm"],
      limit: 6,
      preferDay: true,
    });
    expect(found.turns).toHaveLength(1);
  });

  it("offers a related note from another day when the named days are empty", () => {
    const store = MemoryStore.empty();
    const conversation = store.createConversation(at(2026, 11, 1));
    turn(store, conversation.id, at(2026, 11, 1, 12), "Postgres hosting prices", "Supabase is $25.");
    const found = store.recall({
      windows: [
        {
          label: "10 November",
          startMs: at(2026, 11, 10, 0),
          endMs: at(2026, 11, 11, 0),
          alternates: [],
        },
      ],
      keywords: ["postgres", "hosting"],
      limit: 6,
      preferDay: false,
    });
    expect(found.turns).toHaveLength(0);
    expect(found.related).toHaveLength(1);
    expect(found.related[0].user.content).toContain("Postgres");
  });

  it("round-trips through a file and drops sample chats on reseed", () => {
    const file = path.join(os.tmpdir(), `since-${crypto.randomUUID()}.json`);
    const store = MemoryStore.openFile(file);
    const sample = store.createConversation(at(2026, 11, 3), "Sample", true);
    const real = store.createConversation(at(2026, 11, 12), "Real");
    turn(store, sample.id, at(2026, 11, 3), "sample question", "sample answer");
    turn(store, real.id, at(2026, 11, 12), "real question", "real answer");

    const reopened = MemoryStore.openFile(file);
    expect(reopened.listConversations()).toHaveLength(2);
    reopened.deleteSamples();
    const left = reopened.listConversations();
    expect(left.map((conversation) => conversation.title)).toEqual(["Real"]);
    expect(reopened.getMessages(real.id)).toHaveLength(2);
    fs.unlinkSync(file);
  });
});
