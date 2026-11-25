import { TWITCH_MESSAGE_MAX } from "../shared/defaults";
import { noticeEnabled, placeNotice } from "../shared/feed-toggles";
import { indexChannelEmotes } from "../shared/twitch-emotes";
import { shouldPlayChatAlert, type AlertIdentity } from "../shared/chat-alert";
import { redactError } from "../shared/redact";
import type { CategoryHit, ChatMessage, ModAction, StreamInfo, StreamUpdate } from "../shared/types";
import { getBot } from "./stages/bot";
import { RuntimeCore } from "./runtime-core";

export class RuntimeChat extends RuntimeCore {
  async sendChat(text: string, destinations?: { twitch?: boolean; youtube?: boolean }): Promise<void> {
    const message = text.replace(/\r/g, "").trim();
    if (!message) throw new Error("Message is empty.");
    const twitch = destinations ? destinations.twitch === true : true;
    const youtube = destinations?.youtube === true;
    if (!twitch && !youtube) throw new Error("Pick Twitch or YouTube.");
    const youtubeLive = this.status.youtube.state === "live" && this.status.youtube.canSend === true && Boolean(this.status.youtube.videoId);
    const sendYoutube = youtube && youtubeLive;
    const sendTwitch = twitch && this.auth.state().loggedIn;
    if (!sendTwitch && !sendYoutube) return;
    if (sendTwitch && message.length > TWITCH_MESSAGE_MAX) throw new Error("Twitch messages stop at 500 characters.");
    if (sendYoutube && message.length > 200) throw new Error("YouTube live chat stops at 200 characters.");
    if (Date.now() - this.lastSend < 800) throw new Error("Wait a moment before sending another message.");
    if (sendTwitch) await this.platforms.get("twitch")?.deliver(message);
    if (sendYoutube) {
      try {
        const result = await this.platforms.get("youtube")?.deliver(message);
        if (result === "not-live") return;
      } catch (err) {
        const detail = err instanceof Error ? err.message : "YouTube did not accept that message.";
        if (sendTwitch) throw new Error(`Sent on Twitch. ${detail}`);
        throw err;
      }
    }
    this.lastSend = Date.now();
  }


  searchCategories(query: string): Promise<CategoryHit[]> {
    this.requireUser();
    return this.helix.searchCategories(query);
  }


  async updateStream(update: StreamUpdate): Promise<StreamInfo> {
    const user = this.requireUser();
    await this.helix.updateStream(user.userId, update);
    await this.refreshStream(false);
    if (!this.stream) throw new Error("Saved, but Twitch did not return the channel.");
    this.emit({ type: "toast", tone: "ok", text: "Stream info saved." });
    return this.stream;
  }


  protected async refreshStream(quiet: boolean): Promise<void> {
    const state = this.auth.state();
    if (!state.loggedIn || !state.userId) return;
    try {
      this.stream = await this.helix.getStreamInfo(state.userId);
      this.emit({ type: "stream", stream: this.stream });
    } catch (err) {
      this.log.error("stream info failed", { message: redactError(err) });
      if (!quiet) throw err;
    }
  }


  protected armStreamPoll(): void {
    if (this.streamTimer) return;
    this.streamTimer = setInterval(() => {
      void this.refreshStream(true);
    }, 60_000);
  }


  protected disarmStreamPoll(): void {
    if (!this.streamTimer) return;
    clearInterval(this.streamTimer);
    this.streamTimer = null;
  }


  protected acceptChat(message: ChatMessage): void {
    const feed = this.settings.load().feed;
    if (message.noticeKind && !noticeEnabled(feed, message.noticeKind)) return;
    const placed = placeNotice(this.bus.messages, message);
    if (placed.action === "drop") return;
    for (const segment of placed.message.segments) {
      if (segment.type === "emote") this.emoteImages.prefetch(segment.url);
    }
    if (placed.action === "replace") {
      this.bus.replace(placed.id, placed.message);
      return;
    }
    this.maybeAlert(placed.message);
    if (placed.message.noticeKind) {
      getBot()?.service.noteNotice({
        platform: placed.message.platform,
        kind: placed.message.noticeKind,
        user: placed.message.displayName || placed.message.username,
        amount: placed.message.amount,
        text: placed.message.plainText,
      });
    }
    this.bus.push(placed.message);
  }


  protected maybeAlert(message: ChatMessage): void {
    const settings = this.settings.load().chatAlert;
    const now = Date.now();
    const decision = shouldPlayChatAlert({
      settings,
      message: {
        platform: message.platform,
        username: message.username,
        displayName: message.displayName,
        authorId: message.authorId,
        kind: message.kind,
        noticeKind: message.noticeKind,
        timestamp: message.timestamp,
      },
      identity: this.alertIdentity(),
      now,
      lastPlayedAt: this.lastAlertAt,
      duplicate: false,
    });
    if (!decision.play) return;
    this.lastAlertAt = now;
    this.emit({ type: "chat-alert" });
  }


  protected alertIdentity(): AlertIdentity {
    const selfNames: string[] = [];
    const selfIds: string[] = [];
    const botNames: string[] = [];
    const botIds: string[] = [];
    const add = (bucket: string[], value?: string | null) => {
      if (value && value.trim()) bucket.push(value.trim());
    };
    const auth = this.auth.state();
    add(selfNames, auth.login);
    add(selfIds, auth.userId);
    const desk = this.youtubeSend.state();
    add(selfNames, desk.account);
    add(selfIds, desk.channelId);
    add(selfIds, this.settings.load().youtubeChannelId);
    const posters = getBot()?.service.alertPosters();
    if (posters) {
      selfNames.push(...posters.selfNames);
      selfIds.push(...posters.selfIds);
      botNames.push(...posters.botNames);
      botIds.push(...posters.botIds);
    }
    return { selfNames, selfIds, botNames, botIds };
  }


  protected async loadTwitchEmotes(broadcasterId: string): Promise<void> {
    if (!this.auth.state().loggedIn) return;
    try {
      this.emotes.setTwitch(indexChannelEmotes(await this.helix.getChannelEmotes(broadcasterId)));
    } catch (err) {
      this.log.error("channel emotes failed", { message: redactError(err) });
    }
  }


  protected pushMod(action: ModAction): void {
    if (!this.settings.load().feed.modLog) return;
    if (this.modLog.some((item) => item.id === action.id)) return;
    this.modLog.push(action);
    if (this.modLog.length > 300) this.modLog.splice(0, this.modLog.length - 300);
    this.emit({ type: "mod-log", action });
  }


  protected noteScope(text: string): void {
    if (this.scopeNoted) return;
    this.scopeNoted = true;
    this.emit({ type: "toast", tone: "error", text });
  }


  protected chatChannel(): string {
    const configured = this.settings.load().twitchChannel;
    const login = this.auth.state().loggedIn ? this.auth.state().login ?? "" : "";
    return (configured || login).toLowerCase();
  }


  protected async refreshViewers(): Promise<void> {
    if (!this.auth.state().loggedIn) {
      this.setTwitchViewers(null);
      return;
    }
    const channel = this.chatChannel();
    if (!channel) {
      this.setTwitchViewers(null);
      return;
    }
    try {
      this.setTwitchViewers(await this.helix.getViewerCount(channel));
    } catch (err) {
      this.log.error("viewer count failed", { message: redactError(err) });
    }
  }


  protected setTwitchViewers(count: number | null): void {
    if (this.status.twitch.viewers === count) return;
    this.status = { ...this.status, twitch: { ...this.status.twitch, viewers: count } };
    this.emit({ type: "status", status: this.status });
  }


  protected setYoutubeViewers(count: number | null): void {
    if (this.status.youtube.viewers === count) return;
    this.status = { ...this.status, youtube: { ...this.status.youtube, viewers: count } };
    this.emit({ type: "status", status: this.status });
  }


  protected armViewerPoll(): void {
    if (this.viewerTimer) return;
    this.viewerTimer = setInterval(() => {
      void this.refreshViewers();
    }, 60_000);
  }


  protected disarmViewerPoll(): void {
    if (!this.viewerTimer) return;
    clearInterval(this.viewerTimer);
    this.viewerTimer = null;
  }


  protected forgetStream(): void {
    this.disarmStreamPoll();
    this.stream = null;
    this.emit({ type: "stream", stream: null });
  }

}
