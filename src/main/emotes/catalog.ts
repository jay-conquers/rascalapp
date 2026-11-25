import type { EmoteFlags } from "../../shared/feed-toggles";
import { indexThirdParty, type ThirdPartyPayloads } from "../../shared/third-party";
import type { WordEmote } from "../../shared/word-emotes";
import { redactError } from "../../shared/redact";
import type { Logger } from "../logger";

const ALL_ON: EmoteFlags = { bttv: true, ffz: true, seventv: true };

export class EmoteCatalog {
  map: ReadonlyMap<string, WordEmote> = new Map();
  private flags: EmoteFlags = { ...ALL_ON };
  private globals: ThirdPartyPayloads = {};
  private channel: ThirdPartyPayloads = {};
  private twitch: ReadonlyMap<string, WordEmote> = new Map();
  private roomId: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: { log: Logger; fetchImpl?: typeof fetch; flags?: EmoteFlags }) {
    if (deps.flags) this.flags = { ...deps.flags };
  }

  setFlags(flags: EmoteFlags): void {
    const prev = this.flags;
    this.flags = { bttv: flags.bttv !== false, ffz: flags.ffz !== false, seventv: flags.seventv !== false };
    this.reindex();
    const turnedOn =
      (this.flags.bttv && !prev.bttv) || (this.flags.ffz && !prev.ffz) || (this.flags.seventv && !prev.seventv);
    if (!turnedOn) return;
    void this.loadGlobals();
    if (this.roomId) void this.loadChannelNow();
  }

  setTwitch(emotes: ReadonlyMap<string, WordEmote>): void {
    this.twitch = emotes;
    this.reindex();
  }

  async loadGlobals(): Promise<void> {
    const [bttvGlobal, ffzGlobal, sevenTvGlobal] = await Promise.all([
      this.flags.bttv ? this.getJson("https://api.betterttv.net/3/cached/emotes/global") : Promise.resolve(undefined),
      this.flags.ffz ? this.getJson("https://api.frankerfacez.com/v1/set/global") : Promise.resolve(undefined),
      this.flags.seventv ? this.getJson("https://7tv.io/v3/emote-sets/global") : Promise.resolve(undefined),
    ]);
    this.globals = { bttvGlobal, ffzGlobal, sevenTvGlobal };
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
    const [bttvUser, ffzRoom, sevenTvUser] = await Promise.all([
      this.flags.bttv ? this.getJson(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`) : Promise.resolve(undefined),
      this.flags.ffz ? this.getJson(`https://api.frankerfacez.com/v1/room/id/${roomId}`) : Promise.resolve(undefined),
      this.flags.seventv ? this.getJson(`https://7tv.io/v3/users/twitch/${roomId}`) : Promise.resolve(undefined),
    ]);
    if (this.roomId !== roomId) return;
    this.channel = { bttvUser, ffzRoom, sevenTvUser };
    this.reindex();
  }

  private reindex(): void {
    const payloads: ThirdPartyPayloads = {};
    if (this.flags.bttv) {
      payloads.bttvGlobal = this.globals.bttvGlobal;
      payloads.bttvUser = this.channel.bttvUser;
    }
    if (this.flags.ffz) {
      payloads.ffzGlobal = this.globals.ffzGlobal;
      payloads.ffzRoom = this.channel.ffzRoom;
    }
    if (this.flags.seventv) {
      payloads.sevenTvGlobal = this.globals.sevenTvGlobal;
      payloads.sevenTvUser = this.channel.sevenTvUser;
    }
    const map = indexThirdParty(payloads);
    for (const [name, emote] of this.twitch) map.set(name, emote);
    this.map = map;
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
