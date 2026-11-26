import type { BotSnapshot } from "../../packages/bot/src/service.ts";

/** Talks to a bot process on Fly (or any HTTPS host) with the admin token. */
export class RemoteBot {
  constructor(
    private readonly origin: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  state(): Promise<BotSnapshot> {
    return this.send("GET", "/api/state");
  }

  login(): Promise<BotSnapshot> {
    return this.send("POST", "/api/login");
  }

  logout(): Promise<BotSnapshot> {
    return this.send("POST", "/api/logout");
  }

  saveCommand(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/commands", body);
  }

  deleteCommand(id: string): Promise<BotSnapshot> {
    return this.send("POST", "/api/commands/delete", { id });
  }

  saveTimer(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/timers", body);
  }

  deleteTimer(id: string): Promise<BotSnapshot> {
    return this.send("POST", "/api/timers/delete", { id });
  }

  saveFilters(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/filters", body);
  }

  saveExtras(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/extras", body);
  }

  saveHook(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/hooks", body);
  }

  deleteHook(id: string): Promise<BotSnapshot> {
    return this.send("POST", "/api/hooks/delete", { id });
  }

  async testHook(id: string): Promise<{ ok: boolean; status: number; ms: number; detail: string }> {
    const json: unknown = await this.send("POST", "/api/hooks/test", { id });
    const row = json && typeof json === "object" ? (json as { ok?: unknown; status?: unknown; ms?: unknown; detail?: unknown }) : {};
    return {
      ok: row.ok === true,
      status: typeof row.status === "number" ? row.status : 0,
      ms: typeof row.ms === "number" ? row.ms : 0,
      detail: typeof row.detail === "string" ? row.detail : "",
    };
  }

  importSe(jwt = ""): Promise<BotSnapshot> {
    return this.send("POST", "/api/import/streamelements", { jwt });
  }

  importJson(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/import/json", body);
  }

  exportConfig(): Promise<unknown> {
    return this.send("GET", "/api/export");
  }

  youtubeLogin(): Promise<BotSnapshot> {
    return this.send("POST", "/api/youtube/login");
  }

  youtubeLogout(): Promise<BotSnapshot> {
    return this.send("POST", "/api/youtube/logout");
  }

  youtubeCancel(): Promise<BotSnapshot> {
    return this.send("POST", "/api/youtube/cancel");
  }

  saveAccounts(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/accounts", body);
  }

  saveGoogleClient(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/google-client", body);
  }

  importYoutubeTokens(body: unknown): Promise<BotSnapshot> {
    return this.send("POST", "/api/import/youtube-tokens", body);
  }

  setEnabledPlatforms(enabled: readonly string[]): Promise<BotSnapshot> {
    return this.send("POST", "/api/platforms", { enabled: [...enabled] });
  }

  private async send(method: string, pathname: string, body?: unknown): Promise<BotSnapshot> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(`Can't reach the bot server at ${this.origin}.`);
    }
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) throw new Error("The bot server rejected the admin token.");
    if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : `The bot server returned HTTP ${response.status}.`);
    return json as BotSnapshot;
  }
}
