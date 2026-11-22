import { indexThirdParty, type ThirdPartyPayloads } from "../../shared/third-party";
import type { WordEmote } from "../../shared/word-emotes";
import { redactError } from "../../shared/redact";
import type { Logger } from "../logger";

export class EmoteCatalog {
  map: ReadonlyMap<string, WordEmote> = new Map();
  private globals: ThirdPartyPayloads = {};
  private channel: ThirdPartyPayloads = {};
  private roomId: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: { log: Logger; fetchImpl?: typeof fetch }) {}

  async loadGlobals(): Promise<void> {
    this.globals = {
      bttvGlobal: await this.getJson("https://api.betterttv.net/3/cached/emotes/global"),
      ffzGlobal: await this.getJson("https://api.frankerfacez.com/v1/set/global"),
      sevenTvGlobal: await this.getJson("https://7tv.io/v3/emote-sets/global"),
    };
    this.reindex();
  }

  async loadChannel(roomId: string): Promise<void> {
    if (!/^\d+$/.test(roomId)) return;
    if (this.roomId === roomId && this.timer) return;
    this.roomId = roomId;
    await this.loadChannelNow();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.loadChannelNow();
    }, 30 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async loadChannelNow(): Promise<void> {
    const roomId = this.roomId;
    if (!roomId) return;
    this.channel = {
      bttvUser: await this.getJson(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`),
      ffzRoom: await this.getJson(`https://api.frankerfacez.com/v1/room/id/${roomId}`),
      sevenTvUser: await this.getJson(`https://7tv.io/v3/users/twitch/${roomId}`),
    };
    this.reindex();
  }

  private reindex(): void {
    this.map = indexThirdParty({ ...this.globals, ...this.channel });
    this.deps.log.info("emote catalog updated", { count: this.map.size });
  }

  private async getJson(url: string): Promise<unknown> {
    try {
      const fetchImpl = this.deps.fetchImpl ?? fetch;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) return undefined;
      return await response.json();
    } catch (err) {
      this.deps.log.error("emote fetch failed", { url, message: redactError(err) });
      return undefined;
    }
  }
}
