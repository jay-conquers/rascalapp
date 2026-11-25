import tls from "node:tls";
import { StringDecoder } from "node:string_decoder";
import { applyWordEmotes, type WordEmote } from "../../shared/word-emotes";
import { IrcFramer, parseIrcLine } from "../../shared/parsers/twitch-irc";
import { redactError } from "../../shared/redact";
import type { ChatMessage } from "../../shared/types";
import type { Logger } from "../logger";
import { isAbort, sleep } from "../../shared/sleep";

export class TwitchIrc {
  private socket: tls.TLSSocket | null = null;
  private stopped = true;
  private generation = 0;
  private attempt = 0;
  private channel: string;
  private framer = new IrcFramer();

  constructor(
    private readonly deps: {
      channel: string;
      emotes: () => ReadonlyMap<string, WordEmote>;
      onMessage: (message: ChatMessage) => void;
      onDelete: (id: string) => void;
      onClearUser: (username: string) => void;
      onClearAll: () => void;
      onRoomId: (roomId: string) => void;
      onStatus: (state: "idle" | "connecting" | "connected" | "reconnecting" | "error", detail: string) => void;
      log: Logger;
    },
  ) {
    this.channel = normalizeChannel(deps.channel);
  }

  start(): void {
    if (!this.stopped) return;
    if (!this.channel) {
      this.deps.onStatus("idle", "Set a Twitch channel in Settings.");
      return;
    }
    this.stopped = false;
    void this.loop(++this.generation);
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.socket?.destroy();
    this.socket = null;
  }

  setChannel(channel: string): void {
    const next = normalizeChannel(channel);
    if (next === this.channel) return;
    const previous = this.channel;
    this.channel = next;
    if (!next) {
      const socket = this.socket;
      if (socket && !socket.destroyed && previous) this.write(socket, `PART #${previous}`);
      this.socket?.destroy();
      this.socket = null;
      this.generation++;
      this.stopped = true;
      this.deps.onStatus("idle", "Set a Twitch channel in Settings.");
      return;
    }
    if (this.stopped) {
      this.start();
      return;
    }
    const socket = this.socket;
    if (socket && !socket.destroyed) {
      if (previous) this.write(socket, `PART #${previous}`);
      this.write(socket, `JOIN #${next}`);
      this.deps.onStatus("connected", `Joined #${next}`);
    }
  }

  private async loop(generation: number): Promise<void> {
    while (!this.stopped && generation === this.generation) {
      try {
        this.deps.onStatus("connecting", `Connecting to #${this.channel}…`);
        await this.connectOnce();
        this.attempt = 0;
      } catch (err) {
        if (this.stopped || generation !== this.generation || isAbort(err)) return;
        this.attempt++;
        const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5));
        this.deps.log.error("twitch irc closed", { message: redactError(err) });
        this.deps.onStatus("reconnecting", `Disconnected. Retrying in ${Math.round(wait / 1000)}s.`);
        try {
          await sleep(wait);
        } catch {
          return;
        }
      }
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const nick = `justinfan${Math.floor(10_000 + Math.random() * 89_999)}`;
      let settled = false;
      let joined = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        this.socket = null;
        if (err && !this.stopped) reject(err);
        else resolve();
      };
      const socket = tls.connect({
        host: "irc.chat.twitch.tv",
        port: 6697,
        servername: "irc.chat.twitch.tv",
      });
      this.socket = socket;
      this.framer.reset();
      const decoder = new StringDecoder("utf8");
      socket.once("secureConnect", () => {
        this.write(socket, "CAP REQ :twitch.tv/tags twitch.tv/commands");
        this.write(socket, "PASS SCHMOOPIIE");
        this.write(socket, `NICK ${nick}`);
      });
      socket.on("data", (chunk: Buffer) => {
        for (const line of this.framer.push(decoder.write(chunk))) {
          if (!line) continue;
          let event;
          try {
            event = parseIrcLine(line);
          } catch {
            continue;
          }
          if (event.type === "ping") {
            this.write(socket, `PONG :${event.pingPayload ?? "tmi.twitch.tv"}`);
            continue;
          }
          if (event.type === "reconnect") {
            socket.destroy();
            return;
          }
          if ((event.type === "welcome" || event.command === "CAP") && !joined) {
            joined = true;
            if (!this.channel) {
              this.deps.onStatus("idle", "Set a Twitch channel in Settings.");
              socket.destroy();
              return;
            }
            this.write(socket, `JOIN #${this.channel}`);
            this.deps.onStatus("connected", `Joined #${this.channel}`);
            this.deps.log.info("twitch irc joined", { channel: this.channel });
          }
          if (event.type === "roomstate" && event.roomId) this.deps.onRoomId(event.roomId);
          if (event.type === "notice" && /login (authentication failed|unsuccessful)/i.test(event.message?.plainText ?? "")) {
            this.deps.onStatus("error", "Twitch rejected the chat connection.");
            socket.destroy();
            return;
          }
          if (
            event.message &&
            event.message.plainText &&
            (event.type === "privmsg" || event.type === "usernotice" || event.type === "notice")
          ) {
            const enriched =
              event.type === "privmsg" || event.type === "usernotice"
                ? { ...event.message, segments: applyWordEmotes(event.message.segments, this.deps.emotes()) }
                : event.message;
            this.deps.onMessage(enriched);
          }
          if (event.type === "clearmsg" && event.targetMsgId) this.deps.onDelete(event.targetMsgId);
          if (event.type === "clearchat") {
            if (event.clearAll) this.deps.onClearAll();
            else if (event.targetUser) this.deps.onClearUser(event.targetUser);
          }
        }
      });
      socket.once("error", (err) => finish(err));
      socket.once("close", () => finish(this.stopped ? undefined : new Error("Connection closed.")));
      socket.setTimeout(360_000, () => socket.destroy());
    });
  }

  private write(socket: tls.TLSSocket, line: string): void {
    if (socket.destroyed) return;
    socket.write(`${line}\r\n`);
  }
}

function normalizeChannel(channel: string): string {
  return channel.trim().replace(/^#/, "").toLowerCase();
}
