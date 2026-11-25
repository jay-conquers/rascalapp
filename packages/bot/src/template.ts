import type { ChannelFacts } from "./model.ts";

export interface TemplateContext {
  user: string;
  touser: string;
  count: string;
  randomPool: string;
  facts: ChannelFacts;
  /** Words after the command name. ${1} is the first. */
  args?: string[];
  /** Display names of people who spoke recently. Bots and the broadcaster are already left out. */
  chatters?: readonly string[];
  rng?: () => number;
}

/** Rewrite StreamElements placeholders into Rascal ones. Unknown text is left as it is. */
export function migrateSeTemplate(input: string): string {
  let text = input;
  text = text.replace(/\$\{random\.pick\s+([^}]+)\}|\$\(random\.pick\s+([^)]+)\)/gi, (_full, braced: string | undefined, parens: string | undefined) => {
    const picks = quotedList(braced || parens || "");
    return `{random:${picks.join("|")}}`;
  });
  text = text.replace(/\$\{random\.chatter\}|\$\(random\.chatter\)/gi, "{random.chatter}");
  text = text.replace(/\$\(\s*sender\s*\)|\$\{\s*sender\s*\}/gi, "{user}");
  text = text.replace(/\$\(\s*user(?:name)?\s*\)|\$\{\s*user(?:name)?\s*\}/gi, "{user}");
  text = text.replace(/\$\(\s*(?:touser|target|query)\s*\)|\$\{\s*(?:touser|target|query)\s*\}/gi, "{touser}");
  text = text.replace(/\$\(\s*(count|uptime|game|title|followage)\s*\)|\$\{\s*(count|uptime|game|title|followage)\s*\}/gi, (_full, a: string | undefined, b: string | undefined) => `{${(a || b || "").toLowerCase()}}`);
  text = text.replace(/\$\(\s*(\d+)\s*\)|\$\{\s*(\d+)\s*\}/g, (_full, a: string | undefined, b: string | undefined) => `{${a || b}}`);
  return text;
}

export function expandTemplate(template: string, ctx: TemplateContext): string {
  return expandParts(migrateSeTemplate(template), ctx, 0);
}

function expandParts(input: string, ctx: TemplateContext, depth: number): string {
  if (depth > 6) return input;
  let out = "";
  for (let i = 0; i < input.length; ) {
    if (input.startsWith("$(", i) || input.startsWith("${", i)) {
      const close = input[i + 1] === "(" ? ")" : "}";
      const end = input.indexOf(close, i + 2);
      if (end === -1) {
        out += input[i];
        i += 1;
        continue;
      }
      const inner = input.slice(i + 2, end);
      const original = input.slice(i, end + 1);
      out += evalToken(inner, original, ctx, depth);
      i = end + 1;
      continue;
    }
    if (input[i] === "{") {
      const end = matchingBrace(input, i);
      if (end === -1) {
        out += input[i];
        i += 1;
        continue;
      }
      const inner = input.slice(i + 1, end);
      const original = input.slice(i, end + 1);
      out += evalBrace(inner, original, ctx, depth);
      i = end + 1;
      continue;
    }
    out += input[i];
    i += 1;
  }
  return out;
}

function evalBrace(inner: string, original: string, ctx: TemplateContext, depth: number): string {
  const { name, arg } = splitName(inner);
  return evalName(name, arg, original, ctx, depth);
}

function evalToken(inner: string, original: string, ctx: TemplateContext, depth: number): string {
  const trimmed = inner.trim();
  const pick = trimmed.match(/^random\.pick\s+([\s\S]+)$/i);
  if (pick) return pickAndExpand(quotedList(pick[1] ?? ""), ctx, depth);
  if (/^random\.chatter$/i.test(trimmed)) return randomChatter(ctx);
  if (/^\d+$/.test(trimmed)) return argAt(ctx, Number(trimmed));
  const match = trimmed.match(/^([A-Za-z][A-Za-z.]*)(?:\s+([\s\S]+))?$/);
  if (!match) return original;
  return evalName(match[1] ?? "", match[2] ?? null, original, ctx, depth);
}

function evalName(nameRaw: string, arg: string | null, original: string, ctx: TemplateContext, depth: number): string {
  const name = nameRaw.toLowerCase();
  if (name === "user" || name === "username" || name === "sender") return ctx.user;
  if (name === "touser" || name === "target" || name === "query") return ctx.touser || ctx.user;
  if (name === "count") return ctx.count;
  if (name === "uptime") return ctx.facts.uptime || "offline";
  if (name === "game") return ctx.facts.game || "nothing";
  if (name === "title") return ctx.facts.title || "untitled";
  if (name === "followage") return ctx.facts.followage || "unknown";
  if (name === "amount") return ctx.args?.[0] ?? "";
  if (name === "random.chatter") return randomChatter(ctx);
  if (/^\d+$/.test(name)) return argAt(ctx, Number(name));
  if (name === "random") return pickAndExpand(randomChoices(arg ?? ctx.randomPool), ctx, depth);
  return original;
}

function pickAndExpand(choices: string[], ctx: TemplateContext, depth: number): string {
  if (choices.length === 0) return "";
  const picked = choices[roll(choices.length, ctx.rng)] ?? "";
  return expandParts(picked, ctx, depth + 1);
}

function randomChoices(raw: string): string[] {
  const arg = raw.trim();
  const range = arg.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range && !arg.includes("|") && !arg.includes("{")) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return [String(low + roll(high - low + 1))];
  }
  return splitTop(arg, "|").map((item) => item.trim()).filter(Boolean);
}

function randomChatter(ctx: TemplateContext): string {
  const people = (ctx.chatters ?? []).map((name) => name.trim()).filter(Boolean);
  if (people.length === 0) return "someone";
  return people[roll(people.length, ctx.rng)] ?? "someone";
}

function argAt(ctx: TemplateContext, index: number): string {
  if (index < 1) return "";
  const fromArgs = ctx.args?.[index - 1];
  if (fromArgs) return fromArgs;
  if (index === 1 && ctx.touser) return ctx.touser.split(/\s+/)[0] ?? "";
  return "";
}

function roll(length: number, rng?: () => number): number {
  if (length <= 1) return 0;
  const value = rng ? rng() : Math.random();
  const index = Math.floor(value * length);
  return Math.min(length - 1, Math.max(0, index));
}

function matchingBrace(input: string, open: number): number {
  let depth = 0;
  for (let i = open; i < input.length; i += 1) {
    if (input[i] === "{") depth += 1;
    else if (input[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitName(inner: string): { name: string; arg: string | null } {
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === ":" && depth === 0) return { name: inner.slice(0, i).trim(), arg: inner.slice(i + 1) };
  }
  return { name: inner.trim(), arg: null };
}

function splitTop(input: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

function quotedList(raw: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'|"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const text = (match[1] ?? match[2] ?? "").trim();
    if (text) out.push(text);
  }
  if (out.length > 0) return out;
  return raw.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}
