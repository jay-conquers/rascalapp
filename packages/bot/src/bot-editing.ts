import { normalizeCommand, normalizeFilters, normalizeShoutout, normalizeTimer, type BotCommand, type BotTimer } from "./model.ts";
import { importQuoteList, normalizeQuotes } from "./quotes.ts";
import { normalizeHook, normalizeHooks, redactHookUrl, sampleHookPayload } from "./chat-hook.ts";
import { callChatHook } from "./chat-hook-send.ts";
import { channelIdFromJwt, importStreamElements } from "./se.ts";
import { normalizeThanks } from "./thanks.ts";
import { readYoutubeTokens } from "./store.ts";
import { hookError } from "./errors.ts";
import { asRecord } from "./values.ts";
import { BotState } from "./bot-state.ts";
import type { ChannelTokenBridge } from "./service.ts";

export class BotEditing extends BotState {
  setChannelTokenBridge(bridge: ChannelTokenBridge | null): void {
    this.bridge = bridge;
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
      youtubeChannelId: this.file.youtubeChannelId,
      accounts: this.file.accounts,
      commands: this.file.commands,
      timers: this.file.timers,
      filters: this.file.filters,
      quotes: this.file.quotes,
      thanks: this.file.thanks,
      shoutout: this.file.shoutout,
      hooks: this.file.hooks,
    };
  }


  importConfig(payload: unknown): void {
    const row = asRecord(payload) ?? {};
    const commands = Array.isArray(row.commands) ? row.commands.map(normalizeCommand).filter((item): item is BotCommand => item !== null) : this.file.commands;
    const timers = Array.isArray(row.timers) ? row.timers.map(normalizeTimer).filter((item): item is BotTimer => item !== null) : this.file.timers;
    const filters = row.filters ? normalizeFilters(row.filters) : this.file.filters;
    const channelLogin = typeof row.channelLogin === "string" ? row.channelLogin : this.file.channelLogin;
    const broadcasterId = typeof row.broadcasterId === "string" ? row.broadcasterId : this.file.broadcasterId;
    const quotes = Array.isArray(row.quotes) ? (row.replaceQuotes === true ? normalizeQuotes(row.quotes) : importQuoteList(row.quotes, this.file.quotes)) : this.file.quotes;
    const thanks = row.thanks ? normalizeThanks(row.thanks) : this.file.thanks;
    const shoutout = row.shoutout ? normalizeShoutout(row.shoutout) : this.file.shoutout;
    const hooks = Array.isArray(row.hooks) ? normalizeHooks(row.hooks) : this.file.hooks;
    this.file = this.store.saveConfig({ ...this.file, commands, timers, filters, channelLogin, broadcasterId, quotes, thanks, shoutout, hooks });
  }


  importTokens(payload: unknown): void {
    const row = asRecord(payload) ?? {};
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


  importYoutubeTokens(payload: unknown): void {
    const tokens = readYoutubeTokens(payload);
    if (!tokens) throw new Error("That token file is missing the YouTube session.");
    this.youtubeTokens = tokens;
    this.store.saveYoutubeTokens(tokens);
    this.deps.onAccountsChanged?.();
    void this.registry.get("youtube")?.reconnect();
  }


  saveGoogleClient(input: unknown): void {
    const row = asRecord(input) ?? {};
    const current = this.store.loadGoogleClient();
    const clientId = typeof row.clientId === "string" ? row.clientId.trim() : current.clientId;
    const clientSecret = typeof row.clientSecret === "string" ? row.clientSecret : "";
    if (!clientId) throw new Error("Add a Google client ID.");
    this.store.saveGoogleClient({ clientId, clientSecret });
  }


  saveCommand(input: unknown): void {
    const command = normalizeCommand(input);
    if (!command) throw new Error("That command needs a name and a response.");
    const index = this.file.commands.findIndex((item) => item.id === command.id || item.name === command.name);
    const commands = [...this.file.commands];
    const row = asRecord(input);
    if (index >= 0) {
      const previous = commands[index];
      commands[index] = {
        ...command,
        id: previous?.id ?? command.id,
        aliases: command.aliases.length > 0 ? command.aliases : previous?.aliases ?? [],
        keywords: Array.isArray(row?.keywords) ? command.keywords ?? [] : previous?.keywords ?? command.keywords ?? [],
        count: previous?.count ?? command.count,
        platforms: row && "platforms" in row ? command.platforms : previous?.platforms ?? command.platforms,
      };
    } else commands.push(command);
    this.file = this.store.saveConfig({ ...this.file, commands });
  }


  deleteCommand(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, commands: this.file.commands.filter((item) => item.id !== id) });
  }


  saveHook(input: unknown): void {
    const hook = normalizeHook(input);
    if (!hook) throw new Error("A hook needs a name, a command such as !ask, and an https address. http is only allowed for localhost.");
    const row = asRecord(input);
    const index = this.file.hooks.findIndex((item) => item.id === hook.id || item.name.toLowerCase() === hook.name.toLowerCase());
    const hooks = [...this.file.hooks];
    if (index >= 0) {
      const previous = hooks[index];
      const clearSecret = row?.clearSecret === true;
      hooks[index] = {
        ...hook,
        id: previous?.id ?? hook.id,
        secret: clearSecret ? "" : hook.secret || previous?.secret || "",
        keywords: Array.isArray(row?.keywords) ? hook.keywords : previous?.keywords ?? hook.keywords,
      };
    } else hooks.push(hook);
    this.file = this.store.saveConfig({ ...this.file, hooks: hooks.slice(0, 20) });
  }


  deleteHook(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, hooks: this.file.hooks.filter((item) => item.id !== id) });
  }


  async testHook(id: string): Promise<{ ok: boolean; status: number; ms: number; detail: string }> {
    const hook = this.file.hooks.find((item) => item.id === id);
    if (!hook) throw new Error("That hook is not saved.");
    const started = Date.now();
    try {
      const result = await callChatHook(hook, sampleHookPayload(hook), this.fetchImpl());
      const detail = result.reply ? result.reply.slice(0, 120) : "No chat reply.";
      this.pushLog({ t: Date.now(), action: "hook", user: "", text: `${hook.name} test HTTP ${result.status} ${result.ms}ms`, by: "bot" });
      return { ok: true, status: result.status, ms: result.ms, detail };
    } catch (err) {
      const detail = hookError(err);
      this.pushLog({ t: Date.now(), action: "hook", user: "", text: `${hook.name} test failed: ${detail}`, by: "bot" });
      this.deps.log("error", "chat hook test failed", { hook: hook.name, url: redactHookUrl(hook.url), message: detail });
      return { ok: false, status: 0, ms: Date.now() - started, detail };
    }
  }


  saveExtras(input: unknown): void {
    const row = asRecord(input) ?? {};
    const thanks = "thanks" in row ? normalizeThanks(row.thanks) : this.file.thanks;
    const shoutout = "shoutout" in row ? normalizeShoutout(row.shoutout) : this.file.shoutout;
    let quotes = this.file.quotes;
    if (Array.isArray(row.quotes)) quotes = row.replaceQuotes === true ? normalizeQuotes(row.quotes) : importQuoteList(row.quotes, this.file.quotes);
    this.file = this.store.saveConfig({ ...this.file, thanks, shoutout, quotes });
  }

  /** A notice the desk already kept (toggle on, not a duplicate). The bot may thank them. */

  saveTimer(input: unknown, now = Date.now()): void {
    const timer = normalizeTimer(input);
    if (!timer) throw new Error("That timer needs a name and at least one message.");
    const row = asRecord(input);
    const explicitId = typeof row?.id === "string" && row.id.trim() ? timer.id : "";
    const timers = [...this.file.timers];
    let index = explicitId ? timers.findIndex((item) => item.id === explicitId) : -1;
    if (index < 0 && !explicitId) index = timers.findIndex((item) => item.name.toLowerCase() === timer.name.toLowerCase());
    if (index >= 0) {
      const previous = timers[index];
      if (!previous) return;
      const messagesChanged = previous.messages.join("\n") !== timer.messages.join("\n");
      const liveTimingChanged = previous.intervalSec !== timer.intervalSec || previous.minChatLines !== timer.minChatLines || previous.mode !== timer.mode;
      const offlineTimingChanged =
        previous.offlineIntervalSec !== timer.offlineIntervalSec || previous.offlineMinChatLines !== timer.offlineMinChatLines || previous.mode !== timer.mode;
      const messageIndex = messagesChanged ? 0 : Math.min(previous.messageIndex, Math.max(0, timer.messages.length - 1));
      timers[index] = {
        ...timer,
        id: previous.id,
        messageIndex,
        message: timer.messages[messageIndex] ?? timer.message,
        linesSince: liveTimingChanged ? 0 : previous.linesSince,
        lastFiredAt: liveTimingChanged ? now : previous.lastFiredAt,
        offlineLinesSince: offlineTimingChanged ? 0 : previous.offlineLinesSince,
        offlineLastFiredAt: offlineTimingChanged ? now : previous.offlineLastFiredAt,
        platforms: row && "platforms" in row ? timer.platforms : previous.platforms,
      };
    } else timers.push(timer);
    this.file = this.store.saveConfig({ ...this.file, timers });
  }


  deleteTimer(id: string): void {
    this.file = this.store.saveConfig({ ...this.file, timers: this.file.timers.filter((item) => item.id !== id) });
  }


  saveFilters(input: unknown): void {
    const row = asRecord(input) ?? {};
    const links = asRecord(row.links);
    const caps = asRecord(row.caps);
    const symbols = asRecord(row.symbols);
    this.file = this.store.saveConfig({
      ...this.file,
      filters: normalizeFilters({
        ...this.file.filters,
        ...row,
        links: { ...this.file.filters.links, ...(links ?? {}) },
        caps: { ...this.file.filters.caps, ...(caps ?? {}) },
        symbols: { ...this.file.filters.symbols, ...(symbols ?? {}) },
      }),
    });
  }


  async importSe(jwt?: string): Promise<void> {
    const typed = typeof jwt === "string" ? jwt.trim() : "";
    const token = typed || this.secrets.seJwt.trim();
    if (!token) throw new Error("Paste a StreamElements JWT. None is stored yet.");
    if (token.split(".").length < 3) throw new Error("That does not look like a StreamElements JWT.");
    const fetchImpl = this.fetchImpl();
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
    const row = asRecord(payload) ?? {};
    const commands = imported.commands.length ? imported.commands : (Array.isArray(row.commands) ? row.commands.map(normalizeCommand).filter((item): item is BotCommand => item !== null) : []);
    const timers = imported.timers.length ? imported.timers : (Array.isArray(row.timers) ? row.timers.map(normalizeTimer).filter((item): item is BotTimer => item !== null) : []);
    if (commands.length === 0 && timers.length === 0) throw new Error("That JSON did not contain commands or timers.");
    this.mergeImport(commands, timers);
  }


  protected mergeImport(commands: BotCommand[], timers: BotTimer[]): void {
    const names = new Set(commands.map((command) => command.name));
    const kept = this.file.commands.filter((command) => !names.has(command.name));
    const timerNames = new Set(timers.map((timer) => timer.name));
    const keptTimers = this.file.timers.filter((timer) => !timerNames.has(timer.name));
    this.file = this.store.saveConfig({ ...this.file, commands: [...kept, ...commands], timers: [...keptTimers, ...timers] });
  }

}
