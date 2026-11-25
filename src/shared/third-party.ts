import { safeEmoteUrl } from "./emote-url";
import type { WordEmote } from "./word-emotes";
import { asRecord } from "./record";

export interface ThirdPartyPayloads {
  bttvGlobal?: unknown;
  bttvUser?: unknown;
  ffzGlobal?: unknown;
  ffzRoom?: unknown;
  sevenTvGlobal?: unknown;
  sevenTvUser?: unknown;
}

/** Turn BTTV, FFZ, and 7TV payloads into a name → image map. Unknown shapes are ignored. */
export function indexThirdParty(payloads: ThirdPartyPayloads): Map<string, WordEmote> {
  const map = new Map<string, WordEmote>();
  for (const emote of readBttvList(payloads.bttvGlobal)) add(map, emote, "bttv");
  const user = asRecord(payloads.bttvUser);
  for (const emote of readBttvList(user?.channelEmotes)) add(map, emote, "bttv");
  for (const emote of readBttvList(user?.sharedEmotes)) add(map, emote, "bttv");
  for (const emote of readFfz(payloads.ffzGlobal)) add(map, emote, "ffz");
  for (const emote of readFfz(payloads.ffzRoom)) add(map, emote, "ffz");
  for (const emote of readSeven(payloads.sevenTvGlobal)) add(map, emote, "7tv");
  for (const emote of readSeven(payloads.sevenTvUser)) add(map, emote, "7tv");
  return map;
}

function add(map: Map<string, WordEmote>, emote: WordEmote | null, source: WordEmote["source"]): void {
  if (!emote) return;
  map.set(emote.name, { ...emote, source });
}

function readBttvList(value: unknown): Array<WordEmote | null> {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const record = asRecord(row);
    const id = asString(record?.id);
    const code = asString(record?.code);
    if (!id || !code) return null;
    const url = safeEmoteUrl(`https://cdn.betterttv.net/emote/${encodeURIComponent(id)}/1x`);
    if (!url) return null;
    return { name: code, url, source: "bttv" };
  });
}

function readFfz(value: unknown): Array<WordEmote | null> {
  const sets = asRecord(asRecord(value)?.sets);
  if (!sets) return [];
  const out: Array<WordEmote | null> = [];
  for (const set of Object.values(sets)) {
    const emoticons = asRecord(set)?.emoticons;
    if (!Array.isArray(emoticons)) continue;
    for (const row of emoticons) {
      const record = asRecord(row);
      const name = asString(record?.name);
      const urls = asRecord(record?.urls);
      const raw = asString(urls?.["1"]) ?? asString(urls?.["2"]) ?? asString(urls?.["4"]);
      const url = safeEmoteUrl(raw);
      if (!name || !url) continue;
      out.push({ name, url, source: "ffz" });
    }
  }
  return out;
}

function readSeven(value: unknown): Array<WordEmote | null> {
  const root = asRecord(value);
  const set = asRecord(root?.emote_set) ?? root;
  const emotes = set?.emotes;
  if (!Array.isArray(emotes)) return [];
  return emotes.map((row) => {
    const record = asRecord(row);
    const data = asRecord(record?.data) ?? record;
    const name = asString(record?.name) ?? asString(data?.name);
    const host = asRecord(data?.host);
    const base = asString(host?.url);
    const files = Array.isArray(host?.files) ? host.files : [];
    const file = pickSevenFile(files);
    if (!name || !base || !file) return null;
    const url = safeEmoteUrl(`${base}/${file}`);
    if (!url) return null;
    return { name, url, source: "7tv" as const };
  });
}

function pickSevenFile(files: unknown[]): string | null {
  const names = files
    .map((file) => asString(asRecord(file)?.name))
    .filter((name): name is string => !!name);
  return names.find((name) => name.startsWith("1x.")) ?? names.find((name) => name.startsWith("2x.")) ?? names[0] ?? null;
}


function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
