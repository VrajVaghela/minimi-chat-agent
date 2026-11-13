# Since

Since is a chat agent with one tool, web search. It remembers what you asked, and when, and it checks whether that answer is still true.

## How a turn works

`src/lib/agent/orchestrator.ts` runs every message. The model does not decide whether to remember.

1. **Dates.** Resolve phrases against the clock and `AGENT_TIMEZONE` (default Asia/Kolkata). "Monday" is the most recent Monday, including today. "3 November" with no year is this year, unless that day is still ahead, in which case last year. "Last Tuesday" is the most recent past Tuesday, and if that day is still this week the previous Tuesday is kept as an alternate. The answer says which reading it used when the recent day is empty. "Is that still correct today?" looks up the other date in the sentence, not today.

2. **Memory.** Notes are a JSON file: one person, every conversation, timestamped. A named day is read across sessions, not only the open chat. "What did I ask on 3 November?" returns that day's question and answer and does not search. "Any of them" keeps the day's notes even when the new message never repeats the names. A specific topic that misses ("Postgres" on a day that was only about CRM) falls through to the alternate date, then to a related note on another day.

3. **Search.** A recheck is one query per product. "HubSpot, Attio, Pipedrive, Close, and Folk" becomes five queries, run together, each with its own timeout. A single blended query hides a change in one tool. URLs are deduped, keyword overlap ranks them, and the ones we keep are cited with the time they were fetched. Tavily is the default live provider because it returns a passage, not a raw snippet. Brave is the alternate. With no key, search is off and the answer says so.

4. **Writing.** With a model key, one OpenAI-compatible stream gets the notes and the sources. The model is offered `web_search` only when that first pass came back empty, and at most one extra round. Greetings call neither the model nor the web. With no model key, a deterministic writer quotes the note and the sources. It will not call an old price still current unless that exact figure shows up again.

The footnote under a reply is the route: which day was opened, and whether search ran. The queries are behind it.

## Why this shape

Memory and dates are deterministic. Tools the model can skip would add a round trip and a way to forget "3 November". Search is the only step that has to hit the network, so it is the only tool. Calling it from the orchestrator, in parallel, is faster than waiting for the model to notice that a price needs rechecking, which is also when models forget.

The offline writer exists so `npm run dev` is honest with no keys. It does not invent a live price. `npm run seed` places three sample days using the same resolver, so "last Tuesday" in a prompt and in the file cannot drift apart.

## Rejected

- A memory tool, a date tool, or a page-reading tool. One tool is the brief. A passage, when needed, comes back inside search.
- An LLM router on every turn. The hard prompts are pattern-shaped, and a router call is latency before search starts.
- Embeddings. "3 November" is a range scan, not a similarity problem.
- `node:sqlite`. Still experimental, and it pins Node 22. A JSON file needs no native build.
- Native Anthropic and Gemini clients. One OpenAI-compatible client covers OpenAI, Groq, OpenRouter, and a local server.
- Scraping a search page with no key. A silent fake result is worse than saying search is off.

## Another week

Paraphrase recall for "that hosting question" when no date is named, beside the day index. Structured diffs (old price, new price, source) instead of hoping the writer notices. A replay set of the review prompts against frozen pages, so a prompt edit cannot quietly drop the parallel recheck. A correction in the thread ("I meant 3 November 2025") stored as the reading next time. Per-query status, and cancelling searches the user has already moved on from.
