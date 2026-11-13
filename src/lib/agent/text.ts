/** Lightweight text helpers. Deterministic on purpose: no model call. */

const WORD_STOP = new Set(
  `a an the and or of to for in on at by with from into about as is are was were be been being
i you we they them it this that these those my your our
what when where who how why did do does has have had
ask asked asking say said tell told answer answered
last next past this today yesterday tomorrow then since
monday tuesday wednesday thursday friday saturday sunday
january february march april may june july august september october november december
please thanks thank just also still correct true accurate changed change pricing price prices
any some something big shipped launched recently lately
me us not no yes ok okay hi hello hey
person people team sales tools tool shortlisted shortlist five
up date case right valid current`.split(/\s+/),
);

const ENTITY_STOP = new Set(
  `i we you the a an on for and or of to in it its this that these those
monday tuesday wednesday thursday friday saturday sunday
january february march april may june july august september october november december
jan feb mar apr jun jul aug sep sept oct nov dec
today yesterday tomorrow last next past since then what when where who how
has have had did do does is are was were be been
shortlist shortlisted noted compare compared managed small before storage sample
conversation free standard plus business plan user month yearly billed limited
issues engineering team sales person people tool tools pricing price prices
changed change still correct today answer asked asking about with from into
not yet five those launch launches launched checked check pro
as per just also something shipped big any them these
noted sample here there
crm api usd ist utc pdf`.split(/\s+/),
);

export function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? [];
  return unique(words.filter((word) => !WORD_STOP.has(word))).slice(0, 8);
}

/**
 * Names worth a search of their own.
 * A comma-separated list ("HubSpot, Attio, Pipedrive, Close, and Folk") wins
 * over single capitalized words, so "Shortlist" and "Compare" don't become queries.
 */
export function extractEntities(text: string): string[] {
  const cleaned = text.replace(/'s\b/g, "");
  const listRe =
    /\b([A-Z][A-Za-z0-9.+#&-]{1,}(?:\s*,\s*(?:and\s+)?[A-Z][A-Za-z0-9.+#&-]{1,}){1,})/g;
  const fromLists: string[] = [];
  for (const match of cleaned.matchAll(listRe)) {
    const items = match[1]
      .split(/\s*,\s*/)
      .map((item) => tidyEntity(item.replace(/^and\s+/i, "")))
      .filter((item) => item && !ENTITY_STOP.has(item.toLowerCase()));
    if (items.length >= 2) fromLists.push(...items);
  }
  if (fromLists.length) return unique(fromLists).slice(0, 5);

  const tokens = cleaned.match(/\b[A-Z][A-Za-z0-9.+#&-]{1,}\b/g) ?? [];
  return unique(
    tokens.map(tidyEntity).filter((token) => token && !ENTITY_STOP.has(token.toLowerCase())),
  ).slice(0, 5);
}

function tidyEntity(token: string): string {
  return token.replace(/[.,;:!?]+$/g, "").trim();
}

export function stripPoliteness(text: string): string {
  return text
    .replace(/^(please\s+)?(can|could|would)\s+you\s+/i, "")
    .replace(/^please\s+/i, "")
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleFrom(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (clean.length <= 52) return clean;
  const cut = clean.slice(0, 52);
  const lastSpace = cut.lastIndexOf(" ");
  const base = (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trim();
  return `${base}…`;
}

export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
