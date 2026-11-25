/** True when the phrase appears on a word boundary, ignoring case. */
export function keywordHits(text: string, keyword: string): boolean {
  const phrase = keyword.trim();
  if (phrase.length < 2) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu");
  return pattern.test(text);
}

export function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const raw = typeof item === "string" ? item : keywordText(item);
    const phrase = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (phrase.length < 2 || !/[\p{L}\p{N}]/u.test(phrase)) continue;
    if (/[^\p{L}\p{N}\s'_-]/u.test(phrase)) continue;
    if (out.includes(phrase)) continue;
    out.push(phrase);
    if (out.length >= 20) break;
  }
  return out;
}

function keywordText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  const text = row.keyword ?? row.name ?? row.text;
  return typeof text === "string" ? text : "";
}
