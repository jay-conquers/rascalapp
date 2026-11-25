import { expandTemplate, type TemplateContext } from "./template.ts";
import type { ChannelFacts } from "./model.ts";

export const THANK_KINDS = ["follow", "sub", "resub", "subgift", "cheer", "raid", "redemption"] as const;
export type ThankKind = (typeof THANK_KINDS)[number];

export interface ThankTemplate {
  enabled: boolean;
  template: string;
}

export type ThanksSettings = Record<ThankKind, ThankTemplate>;

const DEFAULT_TEMPLATES: Record<ThankKind, string> = {
  follow: "Thanks for the follow, {user}!",
  sub: "Thanks for subscribing, {user}!",
  resub: "Thanks for resubscribing, {user}! {amount}",
  subgift: "Thanks {user} for the gift!",
  cheer: "Thanks for the cheer, {user}! {amount}",
  raid: "Welcome raiders from {user}! {amount}",
  redemption: "Thanks for the redeem, {user}!",
};

export const GIFT_QUIET_MS = 4_000;
export const GIFT_WINDOW_MS = 12_000;

export interface GiftHold {
  userKey: string;
  user: string;
  count: number;
  lastAt: number;
  amount: string;
}

export function defaultThanks(): ThanksSettings {
  const thanks = {} as ThanksSettings;
  for (const kind of THANK_KINDS) thanks[kind] = { enabled: false, template: DEFAULT_TEMPLATES[kind] };
  return thanks;
}

export function thankKind(value: string | undefined): ThankKind | null {
  return THANK_KINDS.includes(value as ThankKind) ? (value as ThankKind) : null;
}

export function normalizeThanks(value: unknown): ThanksSettings {
  const base = defaultThanks();
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  for (const kind of THANK_KINDS) {
    const item = row[kind] && typeof row[kind] === "object" ? (row[kind] as Record<string, unknown>) : null;
    if (!item) continue;
    const template = typeof item.template === "string" && item.template.trim() ? item.template.trim().slice(0, 450) : base[kind].template;
    base[kind] = { enabled: item.enabled === true, template };
  }
  return base;
}

export function planThankYou(input: {
  thanks: ThanksSettings;
  kind: ThankKind;
  user: string;
  amount: string;
  text: string;
  now: number;
  hold: GiftHold | null;
  facts?: ChannelFacts;
}): { say: string | null; hold: GiftHold | null; waitMs: number } {
  const user = input.user.trim().slice(0, 40) || "someone";
  if (input.kind !== "subgift") {
    const template = input.thanks[input.kind];
    if (!template.enabled) return { say: null, hold: input.hold, waitMs: 0 };
    return { say: renderThank(template.template, user, input.amount, "1", input.text, input.facts), hold: input.hold, waitMs: 0 };
  }
  if (!input.thanks.subgift.enabled) return { say: null, hold: input.hold, waitMs: 0 };
  const userKey = user.toLowerCase();
  let say: string | null = null;
  if (input.hold && input.hold.userKey !== userKey) say = renderGift(input.thanks, input.hold, input.facts);
  const same = input.hold && input.hold.userKey === userKey && input.now - input.hold.lastAt <= GIFT_WINDOW_MS;
  const hold: GiftHold = {
    userKey,
    user,
    count: same ? input.hold!.count + 1 : 1,
    lastAt: input.now,
    amount: input.amount,
  };
  return { say, hold, waitMs: GIFT_QUIET_MS };
}

export function flushGiftHold(
  thanks: ThanksSettings,
  hold: GiftHold | null,
  now: number,
  facts?: ChannelFacts,
  force = false,
): { say: string | null; hold: GiftHold | null } {
  if (!hold) return { say: null, hold };
  if (!force && now - hold.lastAt < GIFT_QUIET_MS) return { say: null, hold };
  return { say: renderGift(thanks, hold, facts), hold: null };
}

function renderGift(thanks: ThanksSettings, hold: GiftHold, facts?: ChannelFacts): string {
  if (hold.count > 1 && !thanks.subgift.template.includes("{count}")) {
    return `Thanks ${hold.user} for gifting ${hold.count} subs!`.slice(0, 450);
  }
  return renderThank(thanks.subgift.template, hold.user, hold.amount, String(hold.count), "", facts);
}

function renderThank(template: string, user: string, amount: string, count: string, text: string, facts?: ChannelFacts): string {
  const ctx: TemplateContext = {
    user,
    touser: user,
    count,
    randomPool: "",
    args: [amount, text],
    facts: facts ?? { title: "", game: "", uptime: "", followage: "" },
  };
  const line = expandTemplate(template, ctx).replace(/\s+/g, " ").trim();
  return line.slice(0, 450);
}
