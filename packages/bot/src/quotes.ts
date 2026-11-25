export interface Quote {
  id: number;
  text: string;
  by: string;
  at: number;
}

export interface QuoteResult {
  say: string;
  quotes: Quote[] | null;
}

export function handleQuote(quotes: readonly Quote[], args: string, by: string, isMod: boolean, now: number, rng?: () => number): QuoteResult {
  const trimmed = args.trim();
  const [head, ...rest] = trimmed.split(/\s+/);
  const verb = (head ?? "").toLowerCase();
  if (verb === "add") {
    if (!isMod) return { say: "Only a mod can change quotes.", quotes: null };
    const text = rest.join(" ").trim().slice(0, 400);
    if (!text) return { say: "Usage: !quote add your text", quotes: null };
    const id = nextQuoteId(quotes);
    const next = [...quotes, { id, text, by: by.slice(0, 25), at: now }].slice(-500);
    return { say: `Added quote #${id}.`, quotes: next };
  }
  if (verb === "remove" || verb === "del" || verb === "delete") {
    if (!isMod) return { say: "Only a mod can change quotes.", quotes: null };
    const id = quoteNumber(rest[0] ?? "");
    if (!id) return { say: "Usage: !quote remove 3", quotes: null };
    if (!quotes.some((quote) => quote.id === id)) return { say: `No quote #${id}.`, quotes: null };
    return { say: `Removed quote #${id}.`, quotes: quotes.filter((quote) => quote.id !== id) };
  }
  const numbered = quoteNumber(verb === "#" ? rest[0] ?? "" : trimmed);
  if (numbered) {
    const found = quotes.find((quote) => quote.id === numbered);
    return { say: found ? formatQuote(found) : `No quote #${numbered}.`, quotes: null };
  }
  if (quotes.length === 0) return { say: "No quotes yet.", quotes: null };
  const index = Math.min(quotes.length - 1, Math.max(0, Math.floor((rng ? rng() : Math.random()) * quotes.length)));
  const picked = quotes[index];
  return { say: picked ? formatQuote(picked) : "No quotes yet.", quotes: null };
}

export function normalizeQuotes(value: unknown): Quote[] {
  if (!Array.isArray(value)) return [];
  const out: Quote[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const quote = oneQuote(item, out);
    if (!quote || seen.has(quote.id)) continue;
    seen.add(quote.id);
    out.push(quote);
    if (out.length >= 500) break;
  }
  return out;
}

/** Append a pasted list. Strings and `{ text }` objects both work. Ids already in the file are kept. */
export function importQuoteList(value: unknown, existing: readonly Quote[]): Quote[] {
  const rows = Array.isArray(value) ? value : [];
  const out = [...existing];
  for (const item of rows) {
    const text = quoteText(item);
    if (!text || out.some((quote) => quote.text === text)) continue;
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    out.push({
      id: nextQuoteId(out),
      text,
      by: typeof row?.by === "string" ? row.by.slice(0, 25) : typeof row?.addedBy === "string" ? row.addedBy.slice(0, 25) : "",
      at: typeof row?.at === "number" && Number.isFinite(row.at) ? row.at : 0,
    });
    if (out.length >= 500) break;
  }
  return out;
}

function oneQuote(value: unknown, existing: readonly Quote[]): Quote | null {
  const text = quoteText(value);
  if (!text) return null;
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const given = typeof row?.id === "number" && Number.isInteger(row.id) && row.id > 0 ? row.id : nextQuoteId(existing);
  return {
    id: given,
    text,
    by: typeof row?.by === "string" ? row.by.slice(0, 25) : "",
    at: typeof row?.at === "number" && Number.isFinite(row.at) ? row.at : 0,
  };
}

function quoteText(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 400);
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  const text = row.text ?? row.quote ?? row.message;
  return typeof text === "string" ? text.trim().slice(0, 400) : "";
}

function formatQuote(quote: Quote): string {
  return `Quote #${quote.id}: ${quote.text}`.slice(0, 450);
}

function quoteNumber(value: string): number | null {
  const match = value.trim().match(/^#?(\d+)$/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function nextQuoteId(quotes: readonly Quote[]): number {
  return quotes.reduce((max, quote) => Math.max(max, quote.id), 0) + 1;
}
