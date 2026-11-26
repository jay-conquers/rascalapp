import type { LoginPromptView } from "../../../../src/shared/platform/bot-platform.ts";
import { YoutubeDataApi } from "../../../../src/shared/platform/youtube-api.ts";
import { createYoutubeAuthRequest, exchangeYoutubeCode, type YoutubeAuthRequest, type YoutubeOAuthClient } from "../../../../src/shared/platform/youtube-oauth.ts";
import type { YoutubeQuotaMeter } from "../../../../src/shared/platform/youtube-quota.ts";
import { safeError } from "../errors.ts";
import { isLoopbackRedirect } from "../public-url.ts";
import type { YoutubeBotTokens } from "../store.ts";
import { waitForYoutubeCallback } from "../../../../src/shared/platform/youtube-callback.ts";

export class YoutubeAccountLogin {
  private prompt: YoutubeAuthRequest | null = null;
  private abort: AbortController | null = null;
  private callback: {
    state: string;
    resolve: (value: { code: string; state: string }) => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(
    private readonly deps: {
      google: () => YoutubeOAuthClient;
      redirect: () => string;
      fetchImpl: () => typeof fetch;
      meter: () => YoutubeQuotaMeter;
      setNote: (note: string) => void;
      save: (tokens: YoutubeBotTokens) => void;
      clear: () => void;
      log: (level: "info" | "error", message: string, extra?: Record<string, string>) => void;
      onChanged: () => void;
      reconnect: () => Promise<void>;
    },
  ) {}

  promptView(): LoginPromptView | null {
    const prompt = this.prompt;
    return prompt ? { userCode: "", verificationUri: prompt.url, expiresAt: prompt.expiresAt } : null;
  }

  accept(input: { code: string; state: string; error: string }): boolean {
    const pending = this.callback;
    if (!pending || !input.state || pending.state !== input.state) return false;
    if (input.error || !input.code) pending.reject(new Error("The YouTube login was cancelled."));
    else pending.resolve({ code: input.code, state: input.state });
    return true;
  }

  async start(): Promise<void> {
    if (this.abort) return;
    const client = this.deps.google();
    const request = createYoutubeAuthRequest(client, undefined, this.deps.redirect());
    this.prompt = request;
    this.deps.setNote("Waiting for Google to approve YouTube.");
    const controller = new AbortController();
    this.abort = controller;
    void this.finish(client, request, controller);
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.prompt = null;
  }

  logout(): void {
    this.cancel();
    this.deps.clear();
    this.deps.setNote("YouTube bot logged out.");
    void this.deps.reconnect();
    this.deps.onChanged();
    this.deps.log("info", "youtube bot logged out");
  }

  private waitForPublic(state: string, signal: AbortSignal): Promise<{ code: string; state: string }> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (err: Error | null, value?: { code: string; state: string }) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (this.callback?.state === state) this.callback = null;
        if (err) reject(err);
        else if (value) resolve(value);
      };
      const onAbort = () => finish(new Error("The YouTube login was cancelled."));
      timer = setTimeout(() => finish(new Error("The YouTube login timed out. Start it again.")), 5 * 60_000);
      signal.addEventListener("abort", onAbort);
      this.callback = {
        state,
        resolve: (value) => finish(null, value),
        reject: (err) => finish(err),
      };
    });
  }

  private async finish(client: YoutubeOAuthClient, request: YoutubeAuthRequest, controller: AbortController): Promise<void> {
    try {
      const callback = isLoopbackRedirect(request.redirectUri)
        ? await waitForYoutubeCallback({ signal: controller.signal, expectedState: request.state })
        : await this.waitForPublic(request.state, controller.signal);
      if (controller.signal.aborted) return;
      if (callback.state !== request.state || !callback.code) throw new Error("That YouTube login did not match. Start again.");
      const exchanged = await exchangeYoutubeCode(client, request, callback.code, this.deps.fetchImpl());
      const api = new YoutubeDataApi({
        token: async () => exchanged.accessToken,
        fetchImpl: this.deps.fetchImpl(),
        meter: this.deps.meter(),
      });
      const identity = await api.myChannel();
      this.deps.save({
        clientId: client.clientId,
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        expiresAt: Date.now() + exchanged.expiresIn * 1000,
        scopes: exchanged.scope.split(/\s+/).filter(Boolean),
        channelId: identity.channelId,
        title: identity.title,
      });
      this.prompt = null;
      this.deps.setNote("");
      this.deps.log("info", "youtube login succeeded", { channel: identity.channelId });
      this.deps.onChanged();
      await this.deps.reconnect();
    } catch (err) {
      if (controller.signal.aborted) return;
      this.prompt = null;
      this.deps.setNote(err instanceof Error ? err.message : "YouTube login failed.");
      this.deps.log("error", "youtube login failed", { message: safeError(err) });
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }
}
