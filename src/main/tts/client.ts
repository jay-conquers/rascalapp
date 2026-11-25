import { brand } from "../../shared/brand";
import { parseTtsState, safeTtsId, type TtsState } from "../../shared/tts";

/**
 * HTTP client for a local tts-queue service.
 * The desk never writes that service's config or unit file.
 */
export class TtsClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async state(): Promise<{ ok: true; state: TtsState } | { ok: false; error: string }> {
    try {
      const response = await this.fetchImpl(this.url("/api/state"), { signal: AbortSignal.timeout(2500), cache: "no-store" });
      if (!response.ok) return { ok: false, error: `tts-queue answered ${response.status} for /api/state.` };
      const parsed = parseTtsState(await response.json());
      if (!parsed) return { ok: false, error: `tts-queue returned a state ${brand.displayName} could not read.` };
      return { ok: true, state: parsed };
    } catch {
      return { ok: false, error: this.down() };
    }
  }

  skip(): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.command("/api/skip");
  }

  clear(): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.command("/api/clear");
  }

  pause(): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.command("/api/pause");
  }

  resume(): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.command("/api/resume");
  }

  async togglePause(): Promise<{ ok: true } | { ok: false; error: string }> {
    const current = await this.state();
    if (!current.ok) return current;
    return current.state.paused ? this.resume() : this.pause();
  }

  hold(on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.command(on ? "/api/hold/on" : "/api/hold/off");
  }

  approveNext(): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.command("/api/approve-next");
  }

  approve(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const safe = safeTtsId(id);
    if (!safe) return Promise.resolve({ ok: false, error: "That TTS item has no usable id." });
    return this.command(`/api/approve/${encodeURIComponent(safe)}`);
  }

  reject(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const safe = safeTtsId(id);
    if (!safe) return Promise.resolve({ ok: false, error: "That TTS item has no usable id." });
    return this.command(`/api/reject/${encodeURIComponent(safe)}`);
  }

  async inject(input: { platform?: string; user?: string; text?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    const platform = input.platform === "youtube" ? "youtube" : "twitch";
    const user = (input.user ?? "").trim().slice(0, 40) || "viewer";
    const text = (input.text ?? "").replace(/\r/g, "").trim().slice(0, 500);
    if (!text) return { ok: false, error: "The test line is empty." };
    try {
      const response = await this.fetchImpl(this.url("/api/test/inject"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, user, text }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return { ok: false, error: `tts-queue answered ${response.status} for /api/test/inject.` };
      return { ok: true };
    } catch {
      return { ok: false, error: this.down() };
    }
  }

  private async command(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!path.startsWith("/api/")) return { ok: false, error: "Unknown TTS control." };
    try {
      const posted = await this.fetchImpl(this.url(path), { method: "POST", signal: AbortSignal.timeout(2500) });
      if (posted.ok) return { ok: true };
      if (posted.status === 405) {
        const got = await this.fetchImpl(this.url(path), { method: "GET", signal: AbortSignal.timeout(2500) });
        if (got.ok) return { ok: true };
        return { ok: false, error: `tts-queue answered ${got.status} for ${path}.` };
      }
      return { ok: false, error: `tts-queue answered ${posted.status} for ${path}.` };
    } catch {
      return { ok: false, error: this.down() };
    }
  }

  private url(path: string): string {
    return `${this.baseUrl().replace(/\/$/, "")}${path}`;
  }

  private down(): string {
    return `Can't reach tts-queue at ${this.baseUrl()}. Is the tts-queue service running?`;
  }
}
