import { redact, redactError } from "../../shared/redact";
import { missingScopes, REQUIRED_SCOPES } from "../../shared/scopes";
import type { AuthState, LoginPrompt } from "../../shared/types";
import { isAbort, sleep } from "../../shared/sleep";
import type { Logger } from "../logger";
import type { TokenStore } from "../tokens";

interface DeviceStart {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
}

interface ValidateResponse {
  client_id: string;
  login: string;
  user_id: string;
  scopes: string[];
  expires_in: number;
}

export class TwitchAuth {
  prompt: LoginPrompt | null = null;
  private abort: AbortController | null = null;
  private refreshing: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: {
      clientId: () => string;
      tokens: TokenStore;
      log: Logger;
      fetchImpl?: typeof fetch;
      openBrowser?: (url: string) => Promise<void>;
      onChange: () => void;
    },
  ) {}

  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.deps.onChange();
    for (const listener of this.listeners) listener();
  }

  state(): AuthState {
    const tokens = this.deps.tokens.current;
    const clientIdSet = this.deps.clientId().length > 0;
    if (!tokens) {
      return { loggedIn: false, login: null, userId: null, scopes: [], missingScopes: [], clientIdSet };
    }
    return {
      loggedIn: true,
      login: tokens.login,
      userId: tokens.userId,
      scopes: tokens.scopes,
      missingScopes: missingScopes(tokens.scopes),
      clientIdSet,
    };
  }

  async restore(): Promise<void> {
    const tokens = this.deps.tokens.current;
    if (!tokens) {
      this.notify();
      return;
    }
    if (tokens.clientId !== this.deps.clientId()) {
      this.deps.log.info("cleared Twitch session because the client ID changed");
      this.logout();
      return;
    }
    try {
      await this.ensureFresh();
      this.deps.log.info("restored Twitch session", { login: this.deps.tokens.current?.login ?? "" });
    } catch (err) {
      this.deps.log.error("Twitch session could not be restored", { message: redactError(err) });
      this.deps.tokens.clear();
    }
    this.notify();
  }

  async ensureFresh(): Promise<string> {
    const tokens = this.deps.tokens.current;
    if (!tokens) throw new Error("Log in with Twitch first.");
    if (tokens.expiresAt - Date.now() > 30 * 60 * 1000) return tokens.accessToken;
    await this.forceRefresh();
    const next = this.deps.tokens.current;
    if (!next) throw new Error("Twitch session expired. Log in again.");
    return next.accessToken;
  }

  /** Used after Helix returns 401 even if the local expiry still looks valid. */
  async forceRefresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
  }

  async login(): Promise<void> {
    if (this.abort) throw new Error("A login is already in progress.");
    const clientId = this.deps.clientId();
    if (!clientId) throw new Error("Add your Twitch client ID in Settings first.");
    const controller = new AbortController();
    this.abort = controller;
    try {
      const device = await this.startDevice(clientId, controller.signal);
      this.prompt = {
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        expiresAt: Date.now() + device.expires_in * 1000,
      };
      this.notify();
      this.deps.log.info("Twitch device login started");
      if (this.deps.openBrowser) {
        try {
          await this.deps.openBrowser(device.verification_uri);
        } catch (err) {
          this.deps.log.error("could not open the browser", { message: redactError(err) });
        }
      }
      const token = await this.poll(clientId, device, controller.signal);
      const identity = await this.validate(token.access_token, controller.signal);
      if (identity.client_id !== clientId) {
        throw new Error("Twitch returned a token for a different application.");
      }
      this.deps.tokens.save({
        clientId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
        scopes: identity.scopes,
        userId: identity.user_id,
        login: identity.login,
      });
      this.prompt = null;
      this.deps.log.info("Twitch login succeeded", { login: identity.login });
      this.notify();
    } catch (err) {
      this.prompt = null;
      this.notify();
      if (isAbort(err)) throw new Error("Login cancelled.");
      throw err;
    } finally {
      this.abort = null;
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  logout(): void {
    this.cancel();
    this.prompt = null;
    this.deps.tokens.clear();
    this.deps.log.info("logged out of Twitch");
    this.notify();
  }

  private async refresh(): Promise<void> {
    const tokens = this.deps.tokens.current;
    const clientId = this.deps.clientId();
    if (!tokens) return;
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    });
    const response = await this.fetchForm("https://id.twitch.tv/oauth2/token", body);
    if (!response.ok) {
      this.deps.tokens.clear();
      this.notify();
      throw new Error("Twitch session expired. Log in again.");
    }
    const json = (await response.json()) as TokenResponse;
    if (!json.access_token || !json.refresh_token) {
      this.deps.tokens.clear();
      throw new Error("Twitch did not return a refreshed session.");
    }
    const identity = await this.validate(json.access_token);
    this.deps.tokens.save({
      clientId,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      scopes: identity.scopes.length > 0 ? identity.scopes : json.scope ?? tokens.scopes,
      userId: identity.user_id || tokens.userId,
      login: identity.login || tokens.login,
    });
    this.deps.log.info("refreshed Twitch session");
    this.notify();
  }

  private async startDevice(clientId: string, signal: AbortSignal): Promise<DeviceStart> {
    const body = new URLSearchParams({
      client_id: clientId,
      scopes: REQUIRED_SCOPES.join(" "),
    });
    const response = await this.fetchForm("https://id.twitch.tv/oauth2/device", body, signal);
    const json = (await response.json().catch(() => ({}))) as Partial<DeviceStart> & { message?: string };
    const verification = json.verification_uri || json.verification_uri_complete;
    if (!response.ok || !json.device_code || !json.user_code || !verification) {
      throw new Error(redact(json.message || `Twitch rejected the login request (${response.status}).`));
    }
    return {
      device_code: json.device_code,
      expires_in: json.expires_in ?? 1800,
      interval: json.interval ?? 5,
      user_code: json.user_code,
      verification_uri: verification,
    };
  }

  private async poll(clientId: string, device: DeviceStart, signal: AbortSignal): Promise<TokenResponse> {
    let interval = Math.max(0, device.interval);
    const deadline = Date.now() + device.expires_in * 1000;
    while (!signal.aborted) {
      await sleep(interval * 1000, signal);
      if (Date.now() > deadline) throw new Error("The login code expired. Try again.");
      const body = new URLSearchParams({
        client_id: clientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      const response = await this.fetchForm("https://id.twitch.tv/oauth2/token", body, signal);
      const json = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string; message?: string };
      if (response.ok && json.access_token && json.refresh_token) return json;
      const code = `${json.error ?? ""} ${json.message ?? ""}`.toLowerCase();
      if (code.includes("slow")) {
        interval += 5;
        continue;
      }
      if (code.includes("pending")) continue;
      if (code.includes("denied")) throw new Error("Twitch login was denied.");
      if (code.includes("expired")) throw new Error("The login code expired. Try again.");
      throw new Error(redact(json.message || json.error || `Twitch login failed (${response.status}).`));
    }
    throw new Error("Login cancelled.");
  }

  private async validate(accessToken: string, signal?: AbortSignal): Promise<ValidateResponse> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${accessToken}` },
      signal,
    });
    if (!response.ok) throw new Error("Twitch could not validate the new session.");
    const json = (await response.json()) as Partial<ValidateResponse>;
    return {
      client_id: json.client_id ?? "",
      login: json.login ?? "",
      user_id: json.user_id ?? "",
      scopes: Array.isArray(json.scopes) ? json.scopes.filter((scope) => typeof scope === "string") : [],
      expires_in: json.expires_in ?? 0,
    };
  }

  private fetchForm(url: string, body: URLSearchParams, signal?: AbortSignal): Promise<Response> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    return fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
  }
}
