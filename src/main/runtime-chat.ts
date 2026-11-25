import { TWITCH_MESSAGE_MAX } from "../shared/defaults";
import { noticeEnabled, placeNotice } from "../shared/feed-toggles";
import { indexChannelEmotes } from "../shared/twitch-emotes";
import { shouldPlayChatAlert, type AlertIdentity } from "../shared/chat-alert";
import { mentionSuggestions, type MentionRoster } from "../shared/mentions";
import {
  describeDeskMod,
  hasChatterScope,
  moderationOffer,
  parseModerationCommand,
  type ModerationCommand,
  type ModerationContext,
} from "../shared/moderation";
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


  mentions(query: string): MentionRoster {
    const directories = this.platforms.list().flatMap((platform) => {
      if (!platform.chatters || platform.mentionsOpen?.() !== true) return [];
      return [platform.chatters()];
    });
    return {
      active: directories.map((directory) => ({ id: directory.id, label: directory.label })),
      suggestions: mentionSuggestions(directories, query, 8),
    };
  }


  async moderate(input: unknown): Promise<void> {
    const command = parseModerationCommand(input);
    const message = this.bus.messages.find((item) => item.id === command.messageId);
    if (!message) throw new Error("That message is no longer in the chat.");
    const offer = moderationOffer(message, this.moderationContext());
    if (command.action === "delete") {
      if (!offer.delete.enabled) throw new Error(offer.delete.reason);
      await this.deleteMessage(message);
      this.recordMod(message, command);
      this.bus.delete(message.id);
      return;
    }
    if (command.action === "timeout") {
      if (!offer.timeout.enabled) throw new Error(offer.timeout.reason);
      await this.banMessageUser(message, command.seconds ?? null);
      this.recordMod(message, command);
      return;
    }
    if (command.action === "ban") {
      if (!offer.ban.enabled) throw new Error(offer.ban.reason);
      await this.banMessageUser(message, null);
      this.recordMod(message, command);
      return;
    }
    if (!offer.unban.enabled) throw new Error(offer.unban.reason);
    await this.unbanMessageUser(message);
    this.recordMod(message, command);
  }


  protected acceptChat(message: ChatMessage): void {
    this.rememberChatter(message);
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


  protected armChatterPoll(): void {
    if (this.chatterTimer) return;
    void this.refreshChatters();
    this.chatterTimer = setInterval(() => {
      void this.refreshChatters();
    }, 60_000);
  }


  protected disarmChatterPoll(): void {
    if (this.chatterTimer) clearInterval(this.chatterTimer);
    this.chatterTimer = null;
    this.listedTwitch = [];
  }


  protected async refreshChatters(): Promise<void> {
    const auth = this.auth.state();
    if (!auth.loggedIn || !auth.userId || !hasChatterScope(auth.scopes)) return;
    if (!this.chatChannel()) return;
    try {
      const broadcasterId = await this.twitchBroadcasterId();
      this.listedTwitch = await this.helix.listChatters(broadcasterId, auth.userId);
    } catch (err) {
      this.log.error("chatters refresh failed", { message: redactError(err) });
    }
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


  private modSeq = 0;

  private rememberChatter(message: ChatMessage): void {
    if (message.kind === "system" && !message.noticeKind) return;
    const name = message.displayName.trim();
    const login = message.username.trim();
    if (!name && !login) return;
    this.session.note(message.platform, { name: name || login, login: login || undefined });
  }


  private moderationContext(): ModerationContext {
    const auth = this.auth.state();
    const settings = this.settings.load();
    const desk = this.youtubeSend.state();
    const ready = this.youtubeSend.sendReadiness();
    const channel = this.chatChannel();
    const sameLogin = Boolean(auth.login && channel && auth.login.toLowerCase() === channel);
    return {
      twitch: {
        loggedIn: auth.loggedIn,
        scopes: auth.scopes,
        login: auth.login,
        userId: auth.userId,
        channelLogin: channel,
        broadcasterId: this.roomId && /^\d+$/.test(this.roomId) ? this.roomId : sameLogin ? auth.userId : null,
      },
      youtube: {
        canModerate: ready.canSend && desk.connected,
        live: this.status.youtube.state === "live" || Boolean(this.status.youtube.videoId),
        channelId: settings.youtubeChannelId.trim(),
        accountChannelId: desk.channelId,
      },
    };
  }


  private async twitchBroadcasterId(): Promise<string> {
    if (this.roomId && /^\d+$/.test(this.roomId)) return this.roomId;
    const user = this.requireUser();
    const channel = this.chatChannel();
    if (!channel || channel === user.login.toLowerCase()) return user.userId;
    if (this.broadcasterCache?.login === channel) return this.broadcasterCache.id;
    const id = await this.helix.getUserId(channel);
    this.broadcasterCache = { login: channel, id };
    return id;
  }


  private async deleteMessage(message: ChatMessage): Promise<void> {
    if (message.platform === "twitch") {
      const user = this.requireUser();
      await this.helix.deleteChatMessage(await this.twitchBroadcasterId(), user.userId, message.id);
      return;
    }
    await this.youtubeSend.deleteLiveMessage(message.id);
  }


  private async banMessageUser(message: ChatMessage, seconds: number | null): Promise<void> {
    if (!message.authorId) throw new Error("This message has no user id.");
    if (message.platform === "twitch") {
      const user = this.requireUser();
      await this.helix.banUser(await this.twitchBroadcasterId(), user.userId, message.authorId, seconds, "");
      return;
    }
    await this.youtubeSend.banLiveUser(message.authorId, seconds, this.status.youtube.videoId);
  }


  private async unbanMessageUser(message: ChatMessage): Promise<void> {
    if (!message.authorId) throw new Error("This message has no user id.");
    if (message.platform === "twitch") {
      const user = this.requireUser();
      await this.helix.unbanUser(await this.twitchBroadcasterId(), user.userId, message.authorId);
      return;
    }
    await this.youtubeSend.unbanLiveUser(message.authorId);
  }


  private recordMod(message: ChatMessage, command: ModerationCommand): void {
    const action = command.action;
    const durationSeconds = action === "timeout" ? command.seconds ?? null : null;
    const actor = message.platform === "twitch" ? this.auth.state().login || "A moderator" : this.youtubeSend.state().account || "A moderator";
    const target = message.displayName || message.username;
    this.pushMod({
      id: `desk-${action}-${message.id}-${Date.now()}-${this.modSeq++}`,
      platform: message.platform,
      channel: message.channel,
      timestamp: Date.now(),
      action,
      actor,
      target,
      durationSeconds,
      reason: "",
      summary: describeDeskMod({ platform: message.platform, actor, target, action, durationSeconds }),
    });
  }

}
