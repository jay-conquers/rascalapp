import { colorForName, safeEmoteUrl } from "../emote-url";
import type { NoticeKind } from "../feed-toggles";
import { clipPlain } from "../plain";
import type { ChatBadge, ChatMessage, ModAction, Segment } from "../types";

export interface LiveContinuation {
  token: string;
  timeoutMs: number;
}

export interface PlayerRead {
  live: boolean;
  videoId?: string;
  title?: string;
  reason: string;
}

export interface ParsedLiveChat {
  messages: ChatMessage[];
  deletedIds: string[];
  deletedAuthorIds: string[];
  /** Deletes and author wipes the page reader actually exposes. Moderator names are usually absent. */
  modActions: ModAction[];
  continuation: LiveContinuation | null;
  ended: boolean;
}

export function extractEmbeddedJson(html: string, name: string): unknown | null {
  const markers = [
    `var ${name} = `,
    `window["${name}"] = `,
    `window['${name}'] = `,
    `${name} = `,
  ];
  const candidates: unknown[] = [];
  for (const marker of markers) {
    let from = 0;
    while (from < html.length) {
      const at = html.indexOf(marker, from);
      if (at === -1) break;
      const parsed = parseJsonAfter(html, at + marker.length);
      if (parsed) candidates.push(parsed);
      from = at + marker.length;
    }
  }
  if (candidates.length === 0) return null;
  if (name === "ytInitialData") {
    const withChat = candidates.find((item) => findLiveChatRenderer(item));
    if (withChat) return withChat;
  }
  if (name === "ytInitialPlayerResponse") {
    const live = candidates.find((item) => interpretPlayer(item).live);
    if (live) return live;
  }
  return candidates[0] ?? null;
}

function parseJsonAfter(html: string, start: number): unknown | null {
  while (start < html.length && /\s/.test(html[start] ?? "")) start++;
  if (html[start] !== "{") return null;
  const slice = sliceJsonObject(html, start);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/** Split a missing chat parser from a broadcast that has chat turned off. */
export function readLiveChatPage(html: string): {
  continuation: LiveContinuation;
  apiKey: string | null;
  clientVersion: string | null;
} {
  const data = extractEmbeddedJson(html, "ytInitialData");
  const renderer = data ? findLiveChatRenderer(data) : null;
  if (!data || !renderer) throw new Error("Couldn't parse the YouTube chat page.");
  const picked = pickContinuation(renderer.continuations);
  if (!picked.continuation) throw new Error("Live chat is turned off for this broadcast.");
  const config = extractInnertubeConfig(html);
  return { continuation: picked.continuation, apiKey: config.apiKey, clientVersion: config.clientVersion };
}

export function sliceJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractInnertubeConfig(html: string): { apiKey: string | null; clientVersion: string | null } {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([A-Za-z0-9_-]+)"/)?.[1] ?? null;
  const clientVersion =
    html.match(/"INNERTUBE_CLIENT_VERSION":"(\d+\.\d+\.\d+(?:\.\d+)?)"/)?.[1] ??
    html.match(/"clientVersion":"(\d+\.\d+\.\d+(?:\.\d+)?)"/)?.[1] ??
    null;
  return { apiKey, clientVersion };
}

/**
 * YouTube dropped a reliable `isLiveNow` flag. A broadcast is live when
 * `videoDetails.isLive` is true, or when the older `isLiveNow` flag is still present.
 * `isLiveContent` stays true on VODs of past streams and is not enough.
 */
export function interpretPlayer(player: unknown): PlayerRead {
  const root = asRecord(player);
  if (!root) return { live: false, reason: "no-player" };
  const details = asRecord(root.videoDetails) ?? {};
  const micro = asRecord(asRecord(root.microformat)?.playerMicroformatRenderer) ?? {};
  const broadcast = asRecord(micro.liveBroadcastDetails) ?? {};
  const videoId = asString(details.videoId) ?? undefined;
  const title = asString(details.title) ?? undefined;
  const playability = asString(asRecord(root.playabilityStatus)?.status);
  if (playability === "LIVE_STREAM_OFFLINE" || playability === "ERROR") {
    return { live: false, videoId, title, reason: playability };
  }
  const isLive = details.isLive === true || details.isLive === "true";
  const isLiveNow = broadcast.isLiveNow === true || broadcast.isLiveNow === "true";
  if (isLive) return { live: true, videoId, title, reason: "videoDetails.isLive" };
  if (isLiveNow) return { live: true, videoId, title, reason: "isLiveNow" };
  return { live: false, videoId, title, reason: "not-live" };
}

/**
 * Concurrent viewers from the watch page player, not videos.list.
 * YouTube puts the live concurrent count in videoDetails.viewCount while isLive is set.
 * A VOD view count is ignored so a past stream is not shown as live viewers.
 */
export function readConcurrentViewers(player: unknown): number | null {
  const root = asRecord(player);
  const details = asRecord(root?.videoDetails);
  const live = details?.isLive === true || details?.isLive === "true";
  if (!live) return null;
  const fromDetails = parseCount(details?.viewCount);
  if (fromDetails !== null) return fromDetails;
  const micro = asRecord(asRecord(root?.microformat)?.playerMicroformatRenderer);
  const broadcast = asRecord(micro?.liveBroadcastDetails);
  return parseCount(broadcast?.concurrentViewers);
}

function parseCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string") {
    const digits = value.replace(/,/g, "");
    if (/^\d{1,12}$/.test(digits)) return Number(digits);
  }
  return null;
}

export interface DetectedBroadcast {
  videoId: string;
  title: string;
  continuation?: LiveContinuation;
  apiKey: string | null;
  clientVersion: string | null;
}

/**
 * A channel /live page is live when the player says so, or when the page
 * already contains a live (not replay) chat renderer. YouTube sometimes
 * leads with a LOGIN_REQUIRED player stub and no videoDetails.isLive; the
 * chat renderer is still present, and an offline channel page has neither.
 */
export function detectLiveFromHtml(html: string): DetectedBroadcast | null {
  const player = extractEmbeddedJson(html, "ytInitialPlayerResponse");
  const read = interpretPlayer(player);
  const config = extractInnertubeConfig(html);
  if (read.live && read.videoId) {
    return {
      videoId: read.videoId,
      title: read.title || pageTitle(html),
      apiKey: config.apiKey,
      clientVersion: config.clientVersion,
    };
  }
  const data = extractEmbeddedJson(html, "ytInitialData");
  const renderer = findLiveChatRenderer(data);
  const picked = pickContinuation(renderer?.continuations);
  const videoId = videoIdFromChatRenderer(renderer);
  if (!picked.continuation || !videoId) return null;
  return {
    videoId,
    title: read.title || pageTitle(html),
    continuation: picked.continuation,
    apiKey: config.apiKey,
    clientVersion: config.clientVersion,
  };
}

export function videoIdFromChatRenderer(renderer: unknown): string | null {
  const stack: unknown[] = [renderer];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.url === "string") {
      const match = record.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match?.[1]) return match[1];
    }
    stack.push(...Object.values(record));
  }
  return null;
}

function pageTitle(html: string): string {
  const raw = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
  return decodeBasic(raw).replace(/\s+-\s+YouTube$/, "").trim();
}

function decodeBasic(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function findLiveChatRenderer(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  const contents = asRecord(root?.contents);
  const direct = asRecord(contents?.liveChatRenderer);
  if (direct) return direct;
  const watch = asRecord(contents?.twoColumnWatchNextResults);
  const bar = asRecord(watch?.conversationBar);
  return asRecord(bar?.liveChatRenderer);
}

export function pickContinuation(continuations: unknown): { continuation: LiveContinuation | null; ended: boolean } {
  if (!Array.isArray(continuations) || continuations.length === 0) {
    return { continuation: null, ended: true };
  }
  let sawReplay = false;
  for (const entry of continuations) {
    const record = asRecord(entry);
    if (!record) continue;
    const data =
      asRecord(record.timedContinuationData) ??
      asRecord(record.invalidationContinuationData) ??
      asRecord(record.reloadContinuationData);
    if (record.liveChatReplayContinuationData && !data) sawReplay = true;
    const token = asString(data?.continuation);
    if (token) {
      const timeout = Number(data?.timeoutMs);
      return {
        continuation: {
          token,
          timeoutMs: Number.isFinite(timeout) && timeout >= 250 ? timeout : 1000,
        },
        ended: false,
      };
    }
  }
  return { continuation: null, ended: sawReplay || true };
}

export function parseLiveChatResponse(body: unknown): ParsedLiveChat {
  const root = asRecord(body);
  const continuationRoot =
    asRecord(asRecord(root?.continuationContents)?.liveChatContinuation) ?? findLiveChatRenderer(body);
  if (!continuationRoot) {
    return { messages: [], deletedIds: [], deletedAuthorIds: [], modActions: [], continuation: null, ended: true };
  }
  const { messages, deletedIds, deletedAuthorIds, modActions } = parseActions(continuationRoot.actions);
  const picked = pickContinuation(continuationRoot.continuations);
  return {
    messages,
    deletedIds,
    deletedAuthorIds,
    modActions,
    continuation: picked.continuation,
    ended: picked.ended,
  };
}

export function parseActions(actions: unknown): {
  messages: ChatMessage[];
  deletedIds: string[];
  deletedAuthorIds: string[];
  modActions: ModAction[];
} {
  const messages: ChatMessage[] = [];
  const deletedIds: string[] = [];
  const deletedAuthorIds: string[] = [];
  const modActions: ModAction[] = [];
  if (!Array.isArray(actions)) return { messages, deletedIds, deletedAuthorIds, modActions };
  for (const action of actions) {
    const record = asRecord(action);
    if (!record) continue;
    const nested = asRecord(record.replayChatItemAction)?.actions;
    if (Array.isArray(nested)) {
      const inner = parseActions(nested);
      messages.push(...inner.messages);
      deletedIds.push(...inner.deletedIds);
      deletedAuthorIds.push(...inner.deletedAuthorIds);
      modActions.push(...inner.modActions);
    }
    const item = asRecord(asRecord(record.addChatItemAction)?.item);
    if (item) {
      const message = messageFromItem(item);
      if (message) messages.push(message);
    }
    const deleted = asString(asRecord(record.markChatItemAsDeletedAction)?.targetItemId);
    if (deleted) {
      deletedIds.push(deleted);
      modActions.push(youtubeModAction(`yt-delete-${deleted}`, "delete", "", "A message was deleted. YouTube did not name the moderator."));
    }
    const author = asString(asRecord(record.markChatItemsByAuthorAsDeletedAction)?.externalChannelId);
    if (author) {
      deletedAuthorIds.push(author);
      modActions.push(
        youtubeModAction(
          `yt-author-${author}`,
          "delete",
          author,
          `Messages from ${author} were removed. YouTube did not say whether this was a ban or a timeout, and it did not name the moderator.`,
        ),
      );
    }
    const banner = moderationBanner(record);
    if (banner) modActions.push(banner);
  }
  return { messages, deletedIds, deletedAuthorIds, modActions };
}

function youtubeModAction(id: string, action: ModAction["action"], target: string, summary: string): ModAction {
  return {
    id,
    platform: "youtube",
    channel: "",
    timestamp: Date.now(),
    action,
    actor: "",
    target: clipPlain(target, 80),
    durationSeconds: null,
    reason: "",
    summary: clipPlain(summary, 400),
  };
}

/** Banners are only logged when the text itself says ban or timeout. Other banners are chat, not mod actions. */
function moderationBanner(record: Record<string, unknown>): ModAction | null {
  const banner = asRecord(asRecord(asRecord(record.addBannerToLiveChatCommand)?.bannerRenderer)?.liveChatBannerRenderer);
  if (!banner) return null;
  const header = textOf(asRecord(asRecord(banner.header)?.liveChatBannerHeaderRenderer)?.text) || textOf(banner.header);
  const text = clipPlain(header, 300);
  if (!text) return null;
  if (/\b(was banned|has been banned|banned from)\b/i.test(text)) {
    return youtubeModAction(`yt-banner-${hashText(text)}`, "ban", "", text);
  }
  if (/\b(timed out|put in timeout|in a timeout)\b/i.test(text)) {
    return youtubeModAction(`yt-banner-${hashText(text)}`, "timeout", "", text);
  }
  return null;
}

function messageFromItem(item: Record<string, unknown>): ChatMessage | null {
  const text = asRecord(item.liveChatTextMessageRenderer);
  if (text) return renderMessage(text, "chat");
  const paid = asRecord(item.liveChatPaidMessageRenderer);
  if (paid) {
    return withNotice(
      renderMessage(paid, "superchat", asString(asRecord(paid.purchaseAmountText)?.simpleText) ?? undefined),
      "superchat",
    );
  }
  const sticker = asRecord(item.liveChatPaidStickerRenderer);
  if (sticker) {
    return withNotice(
      renderMessage(sticker, "superchat", asString(asRecord(sticker.purchaseAmountText)?.simpleText) ?? undefined),
      "supersticker",
    );
  }
  const member = asRecord(item.liveChatMembershipItemRenderer);
  if (member) {
    const header = textOf(member.headerSubtext) || textOf(member.headerPrimaryText) || "Member";
    const message = renderMessage(member, "membership");
    if (!message) return null;
    return {
      ...message,
      noticeKind: "membership",
      notice: header,
      plainText: message.plainText ? `${header} — ${message.plainText}` : header,
    };
  }
  const gift =
    asRecord(item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer) ??
    asRecord(item.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer);
  if (gift) return giftedMembership(gift);
  const milestone = asRecord(item.liveChatViewerEngagementMessageRenderer);
  if (milestone) return engagement(milestone);
  return null;
}

function withNotice(message: ChatMessage | null, noticeKind: NoticeKind): ChatMessage | null {
  if (!message) return null;
  return { ...message, noticeKind };
}

function giftedMembership(renderer: Record<string, unknown>): ChatMessage | null {
  const header =
    textOf(asRecord(asRecord(renderer.header)?.liveChatSponsorshipsHeaderRenderer)?.primaryText) ||
    textOf(renderer.header) ||
    textOf(renderer.primaryText);
  const message = renderMessage(renderer, "membership");
  const line = clipPlain(header, 200) || message?.plainText || "";
  if (!line) return null;
  const base = message ?? renderMessage({ ...renderer, id: renderer.id }, "membership");
  if (!base) return null;
  return {
    ...base,
    noticeKind: "gifted-membership",
    notice: line,
    plainText: base.plainText && base.plainText !== line ? `${line} — ${base.plainText}` : line,
    segments: base.segments.length > 0 ? base.segments : [{ type: "text", text: line }],
  };
}

function engagement(renderer: Record<string, unknown>): ChatMessage | null {
  const line = textOf(renderer.message) || textOf(renderer.header);
  if (!line) return null;
  const message = renderMessage({ ...renderer, message: renderer.message ?? { simpleText: line } }, "system");
  if (!message) return null;
  const text = clipPlain(line, 300);
  return {
    ...message,
    noticeKind: "milestone",
    notice: text,
    plainText: text,
    segments: [{ type: "text", text }],
  };
}

function renderMessage(renderer: Record<string, unknown>, kind: ChatMessage["kind"], amount?: string): ChatMessage | null {
  const displayName = textOf(renderer.authorName) || "YouTube";
  const segments = segmentsFromRuns(asRecord(renderer.message)?.runs);
  const plainText = segments.map((segment) => segment.text).join("").trim();
  if (!plainText && kind === "chat") return null;
  const usec = Number(renderer.timestampUsec);
  const timestamp = Number.isFinite(usec) && usec > 0 ? Math.floor(usec / 1000) : Date.now();
  const id = asString(renderer.id) || `yt-${timestamp}-${hashText(displayName + plainText)}`;
  return {
    id,
    platform: "youtube",
    channel: asString(renderer.authorExternalChannelId) || "",
    username: displayName,
    displayName,
    authorId: asString(renderer.authorExternalChannelId) ?? undefined,
    color: colorForName(displayName),
    badges: youtubeBadges(renderer.authorBadges),
    segments: segments.length > 0 ? segments : [{ type: "text", text: plainText || displayName }],
    plainText: plainText || displayName,
    timestamp,
    kind,
    amount,
  };
}

export function youtubeBadges(value: unknown): ChatBadge[] {
  if (!Array.isArray(value)) return [];
  const badges: ChatBadge[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const renderer = asRecord(asRecord(entry)?.liveChatAuthorBadgeRenderer);
    if (!renderer) continue;
    const icon = asString(asRecord(renderer.icon)?.iconType) ?? "";
    const tooltip =
      asString(renderer.tooltip) ?? asString(asRecord(asRecord(renderer.accessibility)?.accessibilityData)?.label) ?? "";
    const imageUrl = youtubeBadgeImage(renderer);
    let badge: ChatBadge | null = null;
    if (icon === "MODERATOR" || /moderator/i.test(tooltip)) badge = { kind: "mod", label: "MOD" };
    else if (icon === "OWNER" || /owner/i.test(tooltip)) badge = { kind: "owner", label: "OWNER" };
    else if (icon === "MEMBER" || /member/i.test(tooltip)) badge = { kind: "member", label: "MEMBER" };
    else if (imageUrl) badge = { kind: "member", label: "MEMBER" };
    if (badge && imageUrl) badge = { ...badge, imageUrl };
    if (badge && !seen.has(badge.kind)) {
      seen.add(badge.kind);
      badges.push(badge);
    }
  }
  return badges;
}

function youtubeBadgeImage(renderer: Record<string, unknown>): string | undefined {
  return largestHttpsThumb(renderer.customThumbnail) ?? largestHttpsThumb(renderer.icon);
}

function largestHttpsThumb(value: unknown): string | undefined {
  const record = asRecord(value);
  const list = Array.isArray(record?.thumbnails) ? record.thumbnails : [];
  let best = "";
  let bestWidth = -1;
  for (const item of list) {
    const row = asRecord(item);
    const url = asString(row?.url) ?? "";
    if (!url.startsWith("https://")) continue;
    const width = typeof row?.width === "number" ? row.width : 0;
    if (width >= bestWidth) {
      best = url;
      bestWidth = width;
    }
  }
  return best || undefined;
}

function segmentsFromRuns(runs: unknown): Segment[] {
  if (!Array.isArray(runs)) return [];
  const segments: Segment[] = [];
  for (const run of runs) {
    const record = asRecord(run);
    if (!record) continue;
    if (typeof record.text === "string") {
      segments.push({ type: "text", text: record.text });
      continue;
    }
    const emoji = asRecord(record.emoji);
    if (!emoji) continue;
    const shortcuts = Array.isArray(emoji.shortcuts) ? emoji.shortcuts.filter((item) => typeof item === "string") : [];
    const name = (shortcuts[0] as string | undefined) || asString(emoji.emojiId) || "emoji";
    const thumbs = asRecord(emoji.image)?.thumbnails;
    const url = safeEmoteUrl(largestThumbnail(thumbs));
    if (url) segments.push({ type: "emote", text: name, url, source: "youtube" });
    else segments.push({ type: "text", text: name });
  }
  return segments;
}

function largestThumbnail(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  let best: { url: string; width: number } | null = null;
  for (const thumb of value) {
    const record = asRecord(thumb);
    const url = asString(record?.url);
    if (!url) continue;
    const width = Number(record?.width) || 0;
    if (!best || width >= best.width) best = { url, width };
  }
  return best?.url ?? null;
}

function textOf(value: unknown): string {
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.simpleText === "string") return record.simpleText;
  if (Array.isArray(record.runs)) {
    return record.runs.map((run) => (typeof asRecord(run)?.text === "string" ? String(asRecord(run)?.text) : "")).join("");
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hashText(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}
