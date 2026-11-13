# Since — Vraj Vaghela, minimi hiring challenge

A chat agent with one tool, web search. It remembers what you asked and when, and it checks whether that answer is still true.

Vraj Vaghela's submission for the minimi software engineering intern challenge. The architecture is in [DESIGN.md](DESIGN.md).

```bash
git clone https://github.com/VrajVaghela/minimi-chat-agent.git
cd minimi-chat-agent
```

## Run

Node 20 or newer.

```bash
npm install
cp .env.example .env.local   # optional — it runs with no keys
npm run dev
```

Open http://127.0.0.1:3847

With no keys, memory and dates still work. The agent will say that web search is off rather than guess a price. Add keys to `.env.local` when you want live search and a model. Every key is listed in `.env.example`, with where to get it.

| Key | Used for |
| --- | --- |
| `OPENAI_API_KEY` | The writer. Any OpenAI-compatible server. Set `OPENAI_BASE_URL` for Groq or OpenRouter. |
| `TAVILY_API_KEY` | Preferred search. https://app.tavily.com |
| `BRAVE_SEARCH_API_KEY` | Search if Tavily is unset. https://api-dashboard.search.brave.com/app/keys |

`AGENT_TIMEZONE` defaults to `Asia/Kolkata`. "Monday" and "3 November" are resolved in that zone.

## Sample history

The review prompts name Monday, 3 November, and last Tuesday. Seed those three days with the same date resolver the agent uses:

```bash
npm run seed
```

That replaces previous sample chats and leaves real ones alone. Then ask:

- On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?
- What did I ask you on 3 November? Is your answer still correct today?
- Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?

On an empty history the honest answer is that nothing was stored that day.

## Tests

```bash
npm test
```

Covers date resolution, memory recall, search orchestration (parallel, timeout, dedupe), routing of the sample prompts, and the one-tool rule.

## Layout

- `src/lib/agent/orchestrator.ts` — one turn
- `src/lib/agent/dates.ts` — calendar phrases
- `src/lib/agent/memory.ts` — transcript and recall
- `src/lib/agent/plan.ts` — one query per product
- `src/lib/agent/search/` — Tavily, Brave, parallel run
- `src/app/api/chat/route.ts` — server-sent events
- Transcript file: `data/since.json` (gitignored)
