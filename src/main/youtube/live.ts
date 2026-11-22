import {
  BROWSER_UA,
  YOUTUBE_CLIENT_VERSION_FALLBACK,
  YOUTUBE_WEB_API_KEY_FALLBACK,
} from "../../shared/defaults";
import { detectLiveFromHtml, parseLiveChatResponse, readLiveChatPage } from "../../shared/parsers/youtube";
import { redactError } from "../../shared/redact";
import type { ChatMessage } from "../../shared/types";
import type { Logger } from "../logger";
import { isAbort, sleep } from "../sleep";

interface LiveHit {
  videoId: string;
  title: string;
}

interface ChatSession extends LiveHit {
  token: string;
  timeoutMs: number;
  apiKey: string;
  clientVersion: string;
}

export class YoutubeLive {
  private stopped = true;
  private generation = 0;
  private abort = new AbortController();
  private channelId: string;

  constructor(
    private readonly deps: {
      channelId: string;
      onMessage: (message: ChatMessage) => void;
      onDelete: (id: string) => void;
      onDeleteAuthor: (authorId: string) => void;
      onStatus: (status: { state: "idle" | "connecting" | "offline" | "live" | "reconnecting" | "error"; detail: string; videoId?: string; title?: string }) => void;
      log: Logger;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.channelId = deps.channelId;
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
          this.deps.onStatus({ state: "offline", detail: "Channel is offline" });
          await sleep(20_000, signal);
          continue;
        }
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
    let timeoutMs = session.timeoutMs;
    while (!this.stopped && !signal.aborted) {
      await sleep(timeoutMs, signal);
      const response = await this.fetcher(
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
      if (!response.ok) throw new Error(`YouTube chat returned HTTP ${response.status}.`);
      const parsed = parseLiveChatResponse(await response.json());
      for (const message of parsed.messages) {
        this.deps.onMessage({ ...message, channel: this.channelId });
      }
      for (const id of parsed.deletedIds) this.deps.onDelete(id);
      for (const authorId of parsed.deletedAuthorIds) this.deps.onDeleteAuthor(authorId);
      if (parsed.ended || !parsed.continuation) return true;
      token = parsed.continuation.token;
      timeoutMs = parsed.continuation.timeoutMs;
    }
    return false;
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
  const detected = detectLiveFromHtml(await response.text());
  if (!detected) return null;
  return sessionFromDetection(detected);
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

function pageHeaders(): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    "Accept-Language": "en-US,en;q=0.9",
    Cookie:
      "CONSENT=YES+cb.20210328-17-p0.en+FX+667; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwODI2LjA4X3AxGgJlbiACGgYIgLC_sAY",
  };
}
