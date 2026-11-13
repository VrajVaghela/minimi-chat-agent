/**
 * Three sample days, dated with the same resolver the agent uses.
 * Re-running replaces previous sample chats and leaves real ones alone.
 *
 *   npm run seed
 */

import { formatDayLabel, zonedParts, zonedTimeToUtc } from "../src/lib/agent/clock";
import { resolveMentions } from "../src/lib/agent/dates";
import { MemoryStore } from "../src/lib/agent/memory";
import { dataFile, loadConfig } from "../src/lib/config";
import type { StoredMessage } from "../src/lib/agent/types";

const config = loadConfig();
const now = Date.now();
const timeZone = config.timeZone;
const store = MemoryStore.openFile(dataFile());
store.deleteSamples();

function at(phrase: string, hour: number, minute: number): number {
  const mention = resolveMentions(phrase, now, timeZone).find((item) => item.kind === "day");
  if (!mention) throw new Error(`Could not resolve "${phrase}".`);
  const parts = zonedParts(mention.startMs, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, 0, timeZone);
}

function chat(phrase: string, hour: number, minute: number, title: string, user: string, assistant: string) {
  const when = at(phrase, hour, minute);
  const conversation = store.createConversation(when, title, true);
  const messages: StoredMessage[] = [
    {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      content: user,
      createdAt: when,
    },
    {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      content: assistant,
      createdAt: when + 1,
    },
  ];
  store.appendAll(messages);
  console.log(`${phrase} → ${formatDayLabel(when, timeZone)} · ${title}`);
}

chat(
  "3 November",
  11,
  15,
  "Linear pricing",
  "Is Linear's free tier enough for a 20-person engineering team, and what does the paid plan cost?",
  "Linear's Free plan is meant for a small team and caps issues. I had Standard at $10 per user/month and Plus at $16 per user/month, as of 3 November 2026. This is a sample note, so check it again before you rely on it.",
);

chat(
  "Monday",
  10,
  5,
  "CRM shortlist",
  "Shortlist for the 20-person sales team: HubSpot, Attio, Pipedrive, Close, and Folk.",
  "Noted those five — HubSpot, Attio, Pipedrive, Close, and Folk. I have not compared live pricing or recent launches.",
);

chat(
  "last Tuesday",
  16,
  40,
  "Postgres hosting",
  "What did managed Postgres cost for a 20-person team that wants backups and a read replica? Compare Neon, Supabase, and RDS.",
  "Neon Launch is $19/month, Supabase Pro is $25/month, and RDS is about $15/month before storage. Those figures are from this sample note and need a fresh check.",
);

console.log(`Wrote sample chats to ${dataFile()} (${timeZone}).`);
