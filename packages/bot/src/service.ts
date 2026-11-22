import { brand } from "../../../src/shared/brand.ts";
import {
  decideChat,
  dueTimers,
  emptyMemory,
  expandTemplate,
  normalizeBotFile,
  portalBase,
  normalizeCommand,
  normalizeFilters,
  normalizeTimer,
  type BotCommand,
  type BotFile,
  type BotFilters,
  type BotTimer,
  type ChannelFacts,
  type ModLogEntry,
} from "./model.ts";
import { channelIdFromJwt, importStreamElements } from "./se.ts";
import { BotStore, type BotTokens } from "./store.ts";
import { chatSubscription, HelixBot, parseChatFrame, pollDevice, startDevice, age, type DevicePrompt } from "./twitch.ts";

export interface BotLoginPrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface BotSnapshot {
  connected: boolean;
  status: string;
  botLogin: string | null;
  channelLogin: string;
  broadcasterId: string;
  portalUrl: string;
  redirectUri: string;
  login: BotLoginPrompt | null;
  commands: BotCommand[];
  timers: BotTimer[];
  filters: BotFilters;
  log: ModLogEntry[];
  seJwtSet: boolean;
  /** Present so a later build can forward Ask Jeeves lines. Unused in 0.4.0. */
  askJeevesHook: boolean;
}

export interface AskJeevesHook {
  (line: { user: string; text: string; platform: "twitch" }): void;
}

const EMPTY_FACTS: ChannelFacts = { title: "", game: "", uptime: "offline", followage: "" };

export class BotService {
  private file: BotFile;
  private tokens: BotTokens | null;
  private secrets: { apiKey: string; sessionSecret: string; seJwt: string };
  private memory = emptyMemory();
  private log: ModLogEntry[] = [];
  private prompt: DevicePrompt | null = null;
  private loginAbort: AbortController | null = null;
  private status = "Bot is idle.";
  private socket: WebSocket | null = null;
  private stopped = false;
  private facts: ChannelFacts = { ...EMPTY_FACTS };
  private factsAt = 0;
  private followCache = new Map<string, { at: number; text: string }>();
  private askJeeves: AskJeevesHook | null = null;
  private readonly helix: HelixBot;

  constructor(
    private readonly store: BotStore,
    private readonly deps: {
      clientId: () => string;
      fetchImpl?: typeof fetch;
      log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
    },
  ) {
    this.file = store.loadConfig();
    this.tokens = store.loadTokens();
    this.secrets = store.loadSecrets();
    const fetchImpl = deps.fetchImpl ?? fetch;
    this.helix = new HelixBot(() => this.deps.clientId(), () => this.accessToken(), fetchImpl);
  }

  /** Later integration point for the separate tts-queue Ask Jeeves feature. */
  setAskJeeves(hook: AskJeevesHook | null): void {
    this.askJeeves = hook;
  }

  apiKey(): string {
    return this.secrets.apiKey;
  }

  sessionSecret(): string {
    return this.secrets.sessionSecret;
  }

  exportConfig(): Record<string, unknown> {
    return {
      exportedAt: new Date().toISOString(),
      channelLogin: this.file.channelLogin,
      broadcasterId: this.file.broadcasterId,
      commands: this.file.commands,
      timers: this.file.timers,
      filters: this.file.filters,
    };
  }

  importConfig(payload: unknown): void {
    const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const commands = Array.isArray(row.commands) ? row.commands.map(normalizeCommand).filter((item): item is BotCommand => item !== null) : this.file.commands;
    const timers = Array.isArray(row.timers) ? row.timers.map(normalizeTimer).filter((item): item is BotTimer => item !== null) : this.file.timers;
    const filters = row.filters ? normalizeFilters(row.filters) : this.file.filters;
    const channelLogin = typeof row.channelLogin === "string" ? row.channelLogin : this.file.channelLogin;
    const broadcasterId = typeof row.broadcasterId === "string" ? row.broadcasterId : this.file.broadcasterId;
    this.file = this.store.saveConfig({ ...this.file, commands, timers, filters, channelLogin, broadcasterId });
  }

  importTokens(payload: unknown): void {
    const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    if (typeof row.accessToken !== "string" || typeof row.refreshToken !== "string" || typeof row.userId !== "string" || typeof row.login !== "string") {
      throw new Error("That token file is missing the bot session.");
    }
    this.tokens = {
      clientId: typeof row.clientId === "string" ? row.clientId : this.deps.clientId(),
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: typeof row.expiresAt === "number" ? row.expiresAt : Date.now() + 3600_000,
      scopes: Array.isArray(row.scopes) ? row.scopes.filter((item): item is string => typeof item === "string") : [],
      userId: row.userId,
      login: row.login,
    };
    this.store.saveTokens(this.tokens);
    void this.connect();
  }

  snapshot(portalPort: number): BotSnapshot {
    const base = portalBase(this.file.publicUrl, portalPort);
    return {
      connected: Boolean(this.tokens && this.socket),
      status: this.status,
      botLogin: this.tokens?.login ?? null,
      channelLogin: this.file.channelLogin,
      broadcasterId: this.file.broadcasterId,
      portalUrl: `${base}/portal`,
      redirectUri: `${base}/portal/callback`,
      login: this.prompt
        ? { userCode: this.prompt.userCode, verificationUri: this.prompt.verificationUri, expiresAt: this.prompt.expiresAt }
        : null,
      commands: this.file.commands,
      timers: this.file.timers,
      filters: this.file.filters,
      log: this.log.slice(-80),
      seJwtSet: this.secrets.seJwt.length > 0,
      askJeevesHook: this.askJeeves !== null,
    };
  }

  setIdentity(patch: { channelLogin?: string; broadcasterId?: string; publicUrl?: string }): void {
    if (typeof patch.channelLogin === "string") this.file.channelLogin = patch.channelLogin.trim().replace(/^#/, "").toLowerCase();
    if (typeof patch.broadcasterId === "string" && /^\d*$/.test(patch.broadcasterId)) this.file.broadcasterId = patch.broadcasterId;
    if (typeof patch.publicUrl === "string") this.file.publicUrl = patch.publicUrl.trim().replace(/\/$/, "").slice(0, 200);
    this.file = this.store.saveConfig(this.file);
    if (this.tokens) void this.connect();
  }

  async startLogin(): Promise<void> {
    if (this.loginAbort) return;
    const clientId = this.deps.clientId();
    if (!clientId) throw new Error(`Add the Twitch client ID in ${brand.displayName} settings first.`);
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    this.prompt = await startDevice(clientId, fetchImpl);
    this.status = "Waiting for the bot account to approve the code.";
    const controller = new AbortController();
    this.loginAbort = controller;
    void this.finishLogin(clientId, controller);
  }

  cancelLogin(): void {
    this.loginAbort?.abort();
    this.loginAbort = null;
    this.prompt = null;
  }

  logout(): void {
    this.cancelLogin();
    this.tokens = null;
    this.store.clearTokens();
    this.socket?.close();
    this.socket = null;
    this.status = "Bot logged out.";
    this.deps.log("info", "bot logged out");
  }

  saveCommand(input: unknown): void {
    const command = normalizeCommand(input);
    if (!command) throw new Error("That command needs a name and a response.");
    const index = this.file.commands.findIndex((item) => item.id === command.id || item.name === command.name);
    const commands = [...this.file.commands];
    if (index >= 0) {
      const previous = commands[index];
      commands[index] = {
        ...command,
        id: previous?.id ?? command.id,
        aliases: command.aliases.length > 0 ? command.aliases : previous?.aliases ?? [],
        count: previous?.count ?? command.count,
      };
    } else commands.push(command);
    this.file = this.store.saveConfig({ ...this.file, commands });
  }

  deleteCommand(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, commands: this.file.commands.filter((item) => item.id !== id) });
  }

  saveTimer(input: unknown): void {
    const timer = normalizeTimer(input);
    if (!timer) throw new Error("That timer needs a name and a message.");
    const index = this.file.timers.findIndex((item) => item.id === timer.id);
    const timers = [...this.file.timers];
    if (index >= 0) timers[index] = { ...timer, linesSince: timers[index]?.linesSince ?? 0, lastFiredAt: timers[index]?.lastFiredAt ?? 0 };
    else timers.push(timer);
    this.file = this.store.saveConfig({ ...this.file, timers });
  }

  deleteTimer(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, timers: this.file.timers.filter((item) => item.id !== id) });
  }

  saveFilters(input: unknown): void {
    const row = input && typeof input === "object" ? (input as { links?: object; caps?: object; symbols?: object }) : {};
    this.file = this.store.saveConfig({
      ...this.file,
      filters: normalizeFilters({
        ...this.file.filters,
        ...row,
        links: { ...this.file.filters.links, ...(row.links ?? {}) },
        caps: { ...this.file.filters.caps, ...(row.caps ?? {}) },
        symbols: { ...this.file.filters.symbols, ...(row.symbols ?? {}) },
      }),
    });
  }

  async importSe(jwt: string): Promise<void> {
    const token = jwt.trim();
    if (token.split(".").length < 3) throw new Error("That does not look like a StreamElements JWT.");
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    let channel = channelIdFromJwt(token);
    if (!channel) {
      const me = await fetchImpl("https://api.streamelements.com/kappa/v2/channels/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!me.ok) throw new Error("StreamElements rejected that JWT.");
      const body = (await me.json()) as { _id?: string };
      channel = typeof body._id === "string" ? body._id : "";
    }
    if (!/^[a-f0-9]{24}$/i.test(channel)) throw new Error("StreamElements did not say which channel this JWT belongs to.");
    const headers = { Authorization: `Bearer ${token}` };
    const [commandsRes, timersRes] = await Promise.all([
      fetchImpl(`https://api.streamelements.com/kappa/v2/bot/commands/${channel}`, { headers }),
      fetchImpl(`https://api.streamelements.com/kappa/v2/bot/timers/${channel}`, { headers }),
    ]);
    if (!commandsRes.ok) throw new Error("StreamElements did not return commands.");
    const imported = importStreamElements(await commandsRes.json(), timersRes.ok ? await timersRes.json() : []);
    this.mergeImport(imported.commands, imported.timers);
    this.secrets = { ...this.secrets, seJwt: token };
    this.store.saveSecrets(this.secrets);
    this.deps.log("info", "imported streamelements bot data", { commands: String(imported.commands.length), timers: String(imported.timers.length) });
  }

  importJson(payload: unknown): void {
    const imported = importStreamElements(payload, payload);
    const row = payload && typeof payload === "object" ? (payload as { commands?: unknown; timers?: unknown }) : {};
    const commands = imported.commands.length ? imported.commands : (Array.isArray(row.commands) ? row.commands.map(normalizeCommand).filter((item): item is BotCommand => item !== null) : []);
    const timers = imported.timers.length ? imported.timers : (Array.isArray(row.timers) ? row.timers.map(normalizeTimer).filter((item): item is BotTimer => item !== null) : []);
    if (commands.length === 0 && timers.length === 0) throw new Error("That JSON did not contain commands or timers.");
    this.mergeImport(commands, timers);
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const due = dueTimers(this.file, now);
    if (due.length === 0) return;
    for (const timer of due) {
      const text = expandTemplate(timer.message, { user: "chat", touser: "", count: "0", randomPool: "", facts: await this.channelFacts("") });
      await this.say(text);
      timer.lastFiredAt = now;
      timer.linesSince = 0;
      this.pushLog({ t: now, action: "timer", user: "", text: timer.name, by: "bot" });
    }
    this.file = this.store.saveConfig(this.file);
  }

  stop(): void {
    this.stopped = true;
    this.cancelLogin();
    this.socket?.close();
    this.socket = null;
  }

  async connect(): Promise<void> {
    if (!this.tokens || this.stopped) return;
    const url = "wss://eventsub.wss.twitch.tv/ws";
    const socket = new WebSocket(url);
    const previous = this.socket;
    this.socket = socket;
    previous?.close();
    this.status = "Connecting to Twitch chat…";
    socket.addEventListener("message", (event) => {
      void this.onFrame(String(event.data));
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      this.status = "Chat disconnected. Reconnecting…";
      setTimeout(() => void this.connect(), 3000);
    });
  }

  private async finishLogin(clientId: string, controller: AbortController): Promise<void> {
    const prompt = this.prompt;
    if (!prompt) return;
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    try {
      const deadline = prompt.expiresAt;
      while (!controller.signal.aborted && Date.now() < deadline) {
        await sleep(prompt.interval * 1000);
        const result = await pollDevice(clientId, prompt.deviceCode, fetchImpl);
        if (result === "pending") continue;
        if (result === "denied") throw new Error("The bot login was denied.");
        const identity = await this.validate(result.accessToken);
        this.tokens = {
          clientId,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: Date.now() + result.expiresIn * 1000,
          scopes: identity.scopes,
          userId: identity.userId,
          login: identity.login,
        };
        this.store.saveTokens(this.tokens);
        this.prompt = null;
        this.status = `Logged in as ${identity.login}. Mod that account in your channel so it can timeout and delete.`;
        this.deps.log("info", "bot login succeeded", { login: identity.login });
        await this.connect();
        return;
      }
    } catch (err) {
      this.prompt = null;
      this.status = err instanceof Error ? err.message : "Bot login failed.";
      this.deps.log("error", "bot login failed", { message: safeError(err) });
    } finally {
      this.loginAbort = null;
    }
  }

  private async onFrame(raw: string): Promise<void> {
    const frame = parseChatFrame(raw);
    if (frame.kind === "welcome") {
      await this.subscribe(frame.sessionId);
      return;
    }
    if (frame.kind === "reconnect") {
      this.socket?.close();
      return;
    }
    if (frame.kind !== "chat") return;
    if (!this.file.broadcasterId && frame.broadcasterId) {
      this.file.broadcasterId = frame.broadcasterId;
      this.file = this.store.saveConfig(this.file);
    }
    const facts = await this.channelFacts(frame.line.userId);
    const decision = decideChat(this.file, this.memory, frame.line, Date.now(), facts, this.tokens?.userId ?? "");
    if (decision.countCommandId) {
      const command = this.file.commands.find((item) => item.id === decision.countCommandId);
      if (command) command.count += 1;
      if (command?.name === "askjeeves") this.askJeeves?.({ user: frame.line.displayName, text: frame.line.text, platform: "twitch" });
      this.file = this.store.saveConfig(this.file);
    }
    if (decision.chatLine) {
      for (const timer of this.file.timers) timer.linesSince += 1;
    }
    if (decision.log) this.pushLog({ t: Date.now(), ...decision.log });
    try {
      if (decision.deleteMessage) await this.helix.deleteMessage(this.broadcaster(), this.moderator(), frame.line.messageId);
      if (decision.timeoutSec !== null) {
        const userId = decision.targetUserId || (await this.helix.userByLogin(decision.targetLogin))?.id || "";
        if (userId) await this.helix.moderate(this.broadcaster(), this.moderator(), userId, decision.timeoutSec, decision.log?.text ?? "");
      }
      if (decision.ban) {
        const userId = (await this.helix.userByLogin(decision.targetLogin))?.id || "";
        if (userId) await this.helix.moderate(this.broadcaster(), this.moderator(), userId, null, decision.log?.text ?? "");
      }
      if (decision.unban) {
        const userId = (await this.helix.userByLogin(decision.targetLogin))?.id || "";
        if (userId) await this.helix.unban(this.broadcaster(), this.moderator(), userId);
      }
      for (const message of decision.say) await this.say(message);
    } catch (err) {
      this.pushLog({ t: Date.now(), action: "error", user: frame.line.login, text: safeError(err), by: "bot" });
      this.deps.log("error", "bot action failed", { message: safeError(err) });
    }
  }

  private async subscribe(sessionId: string): Promise<void> {
    const broadcaster = this.broadcaster();
    const botUser = this.tokens?.userId ?? "";
    if (!broadcaster || !botUser) {
      this.status = "Set the channel, then connect the bot.";
      return;
    }
    const token = await this.accessToken();
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: { "Client-Id": this.deps.clientId(), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(chatSubscription(sessionId, broadcaster, botUser)),
    });
    this.status = response.ok ? `Listening as ${this.tokens?.login ?? "the bot"}.` : "Twitch did not subscribe the bot to chat.";
    if (!response.ok) this.deps.log("error", "bot chat subscription failed", { status: String(response.status) });
  }

  private async say(message: string): Promise<void> {
    const text = message.trim();
    if (!text || !this.tokens) return;
    await this.helix.send(this.broadcaster(), this.tokens.userId, text.slice(0, 450));
  }

  private async channelFacts(userId: string): Promise<ChannelFacts> {
    if (!this.tokens || !this.file.broadcasterId) return { ...EMPTY_FACTS, followage: "" };
    if (Date.now() - this.factsAt > 60_000) {
      try {
        const channel = await this.helix.channel(this.file.broadcasterId);
        this.facts = { title: channel.title, game: channel.game, uptime: channel.startedAt ? age(channel.startedAt) : "offline", followage: "" };
        this.factsAt = Date.now();
      } catch (err) {
        this.deps.log("error", "channel facts failed", { message: safeError(err) });
      }
    }
    let followage = "";
    if (userId) {
      const cached = this.followCache.get(userId);
      if (cached && Date.now() - cached.at < 10 * 60_000) followage = cached.text;
      else {
        try {
          followage = await this.helix.followage(this.file.broadcasterId, userId);
          this.followCache.set(userId, { at: Date.now(), text: followage });
        } catch {
          followage = "unknown";
        }
      }
    }
    return { ...this.facts, followage };
  }

  private async accessToken(): Promise<string> {
    const tokens = this.tokens;
    if (!tokens) throw new Error("Log in the bot account first.");
    if (tokens.expiresAt - Date.now() > 30 * 60 * 1000) return tokens.accessToken;
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.deps.clientId(), grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
    });
    if (!response.ok) {
      this.logout();
      throw new Error("Bot session expired. Log in again.");
    }
    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!json.access_token || !json.refresh_token) throw new Error("Twitch did not refresh the bot session.");
    this.tokens = { ...tokens, accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    this.store.saveTokens(this.tokens);
    return this.tokens.accessToken;
  }

  private async validate(accessToken: string): Promise<{ login: string; userId: string; scopes: string[] }> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!response.ok) throw new Error("Twitch did not accept the bot token.");
    const json = (await response.json()) as { login?: string; user_id?: string; scopes?: string[] };
    if (!json.login || !json.user_id) throw new Error("Twitch did not identify the bot account.");
    return { login: json.login, userId: json.user_id, scopes: json.scopes ?? [] };
  }

  private broadcaster(): string {
    return this.file.broadcasterId;
  }

  private moderator(): string {
    return this.tokens?.userId ?? "";
  }

  private mergeImport(commands: BotCommand[], timers: BotTimer[]): void {
    const names = new Set(commands.map((command) => command.name));
    const kept = this.file.commands.filter((command) => !names.has(command.name));
    const timerNames = new Set(timers.map((timer) => timer.name));
    const keptTimers = this.file.timers.filter((timer) => !timerNames.has(timer.name));
    this.file = this.store.saveConfig({ ...this.file, commands: [...kept, ...commands], timers: [...keptTimers, ...timers] });
  }

  private pushLog(entry: ModLogEntry): void {
    this.log.push(entry);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Bot request failed.";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/OAuth\s+\S+/gi, "OAuth [redacted]").slice(0, 180);
}

export function loadBotFile(value: unknown): BotFile {
  return normalizeBotFile(value);
}
