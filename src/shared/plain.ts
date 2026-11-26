/** Short id for a chat line. This is not a cryptographic hash. */
export function hashText(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

/** Visible text for chat and the private mod log. Control characters are removed. Markup is left as characters for the UI to escape. */
export function clipPlain(value: unknown, max = 400, keepNewlines = false): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 10 || code === 13) {
      if (keepNewlines) out += "\n";
      else out += " ";
      continue;
    }
    if (code < 32 || code === 127) continue;
    out += char;
  }
  const collapsed = keepNewlines ? out.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : out.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, max);
}
