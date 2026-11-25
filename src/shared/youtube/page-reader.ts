import { readBrandEnv } from "../brand";
import {
  browserUserAgent,
  YOUTUBE_CLIENT_VERSION_FALLBACK,
  YOUTUBE_WEB_API_KEY_FALLBACK,
} from "../defaults";
import { detectLiveFromHtml, extractEmbeddedJson, parseLiveChatResponse, readConcurrentViewers, readLiveChatPage } from "../parsers/youtube";
import { nextYoutubeiPressure, rememberChatIds, youtubeiPollTargetMs, youtubeiWaitMs } from "../platform/youtubei";
import { redactError } from "../redact";
import type { ChatMessage, ModAction } from "../types";
import { isAbort, sleep } from "../sleep";

/** Enough of a logger for the page reader. The desktop logger satisfies this. */
export interface PageReaderLog {
  info(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

interface LiveHit {
  videoId: string;
  title: string;
}

interface ChatSession extends LiveHit {
  token: string;
  timeoutMs: number;
  apiKey: string;
  clientVersion: string;
  viewers?: number | null;
}

export class YoutubeLive {
  private stopped = true;
  private generation = 0;
  private abort = new AbortController();
  private channelId: string;
  private readerFailures = 0;
  private readonly seen = new Set<string>();
  private readonly pollMs: number;
  private viewersAt = 0;

  constructor(
    private readonly deps: {
      channelId: string;
      onMessage: (message: ChatMessage) => void;
      onDelete: (id: string) => void;
      onDeleteAuthor: (authorId: string) => void;
      onModAction?: (action: ModAction) => void;
      onViewers?: (count: number | null) => void;
      onStatus: (status: { state: "idle" | "connecting" | "offline" | "live" | "reconnecting" | "error"; detail: string; videoId?: string; title?: string }) => void;
      onHealth?: (health: { ok: boolean; consecutiveFailures: number }) => void;
      log: PageReaderLog;
      fetchImpl?: typeof fetch;
      /** Page-reader gap. Defaults to 1.5s and never below 1s. `RASCAL_YOUTUBE_POLL_MS` overrides it. */
      pollMs?: number;
    },
  ) {
    this.channelId = deps.channelId;
    this.pollMs = youtubeiPollTargetMs(deps.pollMs, readBrandEnv("YOUTUBE_POLL_MS"));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop(++this.generation, this.abort.signal);
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.abort.abort();
  }

  setChannel(channelId: string): void {
    if (channelId === this.channelId) return;
    this.channelId = channelId;
    this.abort.abort();
    this.abort = new AbortController();
    if (!this.stopped) void this.loop(++this.generation, this.abort.signal);
  }

  private async loop(generation: number, signal: AbortSignal): Promise<void> {
    if (!this.channelId.trim()) {
      this.deps.onStatus({ state: "idle", detail: "Set a YouTube channel ID in Settings." });
      return;
    }
    let backoff = 3_000;
    while (!this.stopped && generation === this.generation && !signal.aborted) {
      try {
        this.deps.onStatus({ state: "connecting", detail: "Checking for a live stream…" });
        const live = await detectLive(this.channelId, this.fetcher, signal);
        if (!live) {
          this.deps.onViewers?.(null);
          this.deps.onStatus({ state: "offline", detail: "Channel is offline" });
          await sleep(20_000, signal);
          continue;
        }
        if (typeof live.viewers === "number") this.deps.onViewers?.(live.viewers);
        this.deps.onStatus({
          state: "live",
          detail: live.title || "Live",
          videoId: live.videoId,
          title: live.title,
        });
        this.deps.log.info("youtube live attached", { videoId: live.videoId });
        const session = live.token ? live : await openLiveChat(live, this.fetcher, signal);
        backoff = 3_000;
        const ended = await this.poll(session, signal);
        if (!ended) return;
        this.deps.onStatus({ state: "offline", detail: "Stream ended. Watching for the next one." });
        await sleep(15_000, signal);
      } catch (err) {
        if (this.stopped || generation !== this.generation || isAbort(err)) return;
        const wait = Math.min(60_000, backoff);
        backoff = Math.min(60_000, backoff * 2);
        const message = redactError(err);
        this.noteReader(false);
        this.deps.log.error("youtube chat interrupted", { message });
        this.deps.onStatus({ state: "reconnecting", detail: message });
        try {
          await sleep(wait, signal);
        } catch {
          return;
        }
      }
    }
  }

  private async poll(session: ChatSession, signal: AbortSignal): Promise<boolean> {
    let token = session.token;
    let suggested = session.timeoutMs;
    let pressure = 0;
    while (!this.stopped && !signal.aborted) {
      let response: Response;
      try {
        response = await this.fetcher(
          `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=${encodeURIComponent(session.apiKey)}`,
          {
            method: "POST",
            signal,
            headers: {
              ...pageHeaders(),
              "Content-Type": "application/json",
              Origin: "https://www.youtube.com",
              Referer: `https://www.youtube.com/live_chat?v=${encodeURIComponent(session.videoId)}`,
              "X-YouTube-Client-Name": "1",
              "X-YouTube-Client-Version": session.clientVersion,
            },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: "WEB",
                  clientVersion: session.clientVersion,
                  hl: "en",
                  gl: "US",
                },
              },
              continuation: token,
            }),
          },
        );
      } catch (err) {
        if (this.stopped || isAbort(err)) return false;
        pressure = nextYoutubeiPressure(pressure, "error");
        this.noteReader(false);
        await sleep(youtubeiWaitMs({ targetMs: this.pollMs, suggestedMs: suggested, pressure }), signal);
        continue;
      }
      if (response.status === 429 || !response.ok) {
        pressure = nextYoutubeiPressure(pressure, response.status === 429 ? "rate-limit" : "error");
        this.noteReader(false);
        await sleep(youtubeiWaitMs({ targetMs: this.pollMs, suggestedMs: suggested, pressure }), signal);
        continue;
      }
      const parsed = parseLiveChatResponse(await response.json());
      const fresh = new Set(rememberChatIds(this.seen, parsed.messages.map((message) => message.id)));
      for (const message of parsed.messages) {
        if (!fresh.has(message.id)) continue;
        this.deps.onMessage({ ...message, channel: this.channelId });
      }
      for (const id of parsed.deletedIds) this.deps.onDelete(id);
      for (const authorId of parsed.deletedAuthorIds) this.deps.onDeleteAuthor(authorId);
      for (const action of parsed.modActions) {
        this.deps.onModAction?.({ ...action, channel: this.channelId });
      }
      void this.maybeViewers(session.videoId, signal);
      this.noteReader(true);
      pressure = nextYoutubeiPressure(pressure, "ok");
      if (parsed.ended || !parsed.continuation) return true;
      token = parsed.continuation.token;
      suggested = parsed.continuation.timeoutMs;
      await sleep(youtubeiWaitMs({ targetMs: this.pollMs, suggestedMs: suggested, pressure }), signal);
    }
    return false;
  }

  private async maybeViewers(videoId: string, signal: AbortSignal): Promise<void> {
    if (Date.now() - this.viewersAt < 60_000) return;
    this.viewersAt = Date.now();
    try {
      const response = await this.fetcher(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
        signal,
        headers: pageHeaders(),
      });
      if (!response.ok) return;
      const count = readConcurrentViewers(extractEmbeddedJson(await response.text(), "ytInitialPlayerResponse"));
      if (count !== null) this.deps.onViewers?.(count);
    } catch (err) {
      if (this.stopped || isAbort(err)) return;
    }
  }

  private noteReader(ok: boolean): void {
    if (ok) {
      if (this.readerFailures === 0) return;
      this.readerFailures = 0;
      this.deps.onHealth?.({ ok: true, consecutiveFailures: 0 });
      return;
    }
    this.readerFailures += 1;
    this.deps.onHealth?.({ ok: false, consecutiveFailures: this.readerFailures });
  }

  private get fetcher(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }
}

export async function detectLive(
  channelId: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ChatSession | null> {
  const response = await fetchImpl(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`, {
    redirect: "follow",
    signal,
    headers: pageHeaders(),
  });
  const html = await response.text();
  const detected = detectLiveFromHtml(html);
  if (!detected) return null;
  const viewers = readConcurrentViewers(extractEmbeddedJson(html, "ytInitialPlayerResponse"));
  return { ...sessionFromDetection(detected), viewers };
}

function sessionFromDetection(detected: {
  videoId: string;
  title: string;
  continuation?: { token: string; timeoutMs: number };
  apiKey: string | null;
  clientVersion: string | null;
}): ChatSession {
  if (!detected.continuation) {
    return {
      videoId: detected.videoId,
      title: detected.title,
      token: "",
      timeoutMs: 0,
      apiKey: detected.apiKey || YOUTUBE_WEB_API_KEY_FALLBACK,
      clientVersion: detected.clientVersion || YOUTUBE_CLIENT_VERSION_FALLBACK,
    };
  }
  return {
    videoId: detected.videoId,
    title: detected.title,
    token: detected.continuation.token,
    timeoutMs: Math.max(1000, detected.continuation.timeoutMs),
    apiKey: detected.apiKey || YOUTUBE_WEB_API_KEY_FALLBACK,
    clientVersion: detected.clientVersion || YOUTUBE_CLIENT_VERSION_FALLBACK,
  };
}

async function openLiveChat(live: LiveHit, fetchImpl: typeof fetch, signal: AbortSignal): Promise<ChatSession> {
  const response = await fetchImpl(
    `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(live.videoId)}`,
    { signal, headers: pageHeaders() },
  );
  if (!response.ok) throw new Error(`YouTube live chat page returned HTTP ${response.status}.`);
  const page = readLiveChatPage(await response.text());
  return {
    ...live,
    token: page.continuation.token,
    timeoutMs: Math.max(1000, page.continuation.timeoutMs),
    apiKey: page.apiKey || YOUTUBE_WEB_API_KEY_FALLBACK,
    clientVersion: page.clientVersion || YOUTUBE_CLIENT_VERSION_FALLBACK,
  };
}

/**
 * A fixed consent cookie so YouTube returns the watch page instead of the
 * consent wall. It is not a login session: there is no SID, HSID, SSID,
 * SAPISID, or LOGIN_INFO. Every install sends the same value.
 */
export const YOUTUBE_CONSENT_COOKIE =
  "CONSENT=YES+cb.20210328-17-p0.en+FX+667; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwODI2LjA4X3AxGgJlbiACGgYIgLC_sAY";

export function youtubePageHeaders(): Record<string, string> {
  return pageHeaders();
}

function pageHeaders(): Record<string, string> {
  return {
    "User-Agent": browserUserAgent(),
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: YOUTUBE_CONSENT_COOKIE,
  };
}
