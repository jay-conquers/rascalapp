import type { EmoteSegment, Segment } from "./types";

export interface WordEmote {
  name: string;
  url: string;
  source: EmoteSegment["source"];
}

export function applyWordEmotes(segments: Segment[], emotes: ReadonlyMap<string, WordEmote>): Segment[] {
  if (emotes.size === 0) return segments;
  const out: Segment[] = [];
  for (const segment of segments) {
    if (segment.type !== "text" || segment.text.length === 0) {
      out.push(segment);
      continue;
    }
    for (const part of segment.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        out.push({ type: "text", text: part });
        continue;
      }
      const matched = matchToken(part, emotes);
      if (!matched) {
        out.push({ type: "text", text: part });
        continue;
      }
      if (matched.lead) out.push({ type: "text", text: matched.lead });
      out.push({
        type: "emote",
        text: matched.emote.name,
        url: matched.emote.url,
        source: matched.emote.source,
      });
      if (matched.tail) out.push({ type: "text", text: matched.tail });
    }
  }
  return mergeText(out);
}

function matchToken(
  token: string,
  emotes: ReadonlyMap<string, WordEmote>,
): { lead: string; tail: string; emote: WordEmote } | null {
  const direct = emotes.get(token);
  if (direct) return { lead: "", tail: "", emote: direct };
  const stripped = token.replace(/^[^\w]+|[^\w]+$/g, "");
  if (!stripped || stripped === token) return null;
  const hit = emotes.get(stripped);
  if (!hit) return null;
  const at = token.indexOf(stripped);
  return { lead: token.slice(0, at), tail: token.slice(at + stripped.length), emote: hit };
}

function mergeText(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const prev = merged[merged.length - 1];
    if (segment.type === "text" && prev?.type === "text") prev.text += segment.text;
    else merged.push(segment);
  }
  return merged;
}
