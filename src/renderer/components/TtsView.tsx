import { useEffect, useState } from "react";
import { CheckRow } from "./CheckRow";
import { brand } from "../../shared/brand";
import type { TtsPanel } from "../../shared/tts";

const EMPTY: TtsPanel = {
  baseUrl: "http://127.0.0.1:17761",
  ok: false,
  error: "",
  state: null,
  shortcuts: { enabled: false, supported: true, detail: "Checking shortcut support…" },
};

export function TtsView() {
  const [panel, setPanel] = useState<TtsPanel>(EMPTY);
  const [baseUrl, setBaseUrl] = useState(EMPTY.baseUrl);
  const [testUser, setTestUser] = useState("viewer");
  const [testText, setTestText] = useState(`This is a test line from ${brand.displayName}.`);
  const [platform, setPlatform] = useState<"twitch" | "youtube">("twitch");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    async function tick(): Promise<void> {
      if (!window.rascal) return;
      try {
        const next = await window.rascal.ttsState();
        if (stopped) return;
        setPanel(next);
        setBaseUrl((current) => (document.activeElement?.id === "tts-base" ? current : next.baseUrl));
      } catch (err) {
        if (stopped) return;
        setPanel((current) => ({
          ...current,
          ok: false,
          state: null,
          error: err instanceof Error ? err.message : "Could not reach tts-queue.",
        }));
      }
    }
    function arm(): void {
      window.clearInterval(timer);
      const hidden = document.visibilityState === "hidden";
      timer = window.setInterval(() => void tick(), hidden ? 4000 : 1000);
    }
    void tick();
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, []);

  async function run(work: () => Promise<TtsPanel>): Promise<void> {
    setBusy(true);
    try {
      setPanel(await work());
    } catch (err) {
      setPanel((current) => ({ ...current, error: err instanceof Error ? err.message : "TTS request failed." }));
    } finally {
      setBusy(false);
    }
  }

  const state = panel.state;
  const down = !panel.ok;

  return (
    <section className="tts-page">
      <header className="redeem-bar">
        <div>
          <h2>TTS</h2>
          <p>Controls the tts-queue service. {brand.displayName} does not replace it.</p>
        </div>
        <p className={down ? "tts-down" : "tts-up"}>{down ? "Service down" : "Connected"}</p>
      </header>

      {panel.error ? (
        <div className="banner">
          <p>{panel.error}</p>
        </div>
      ) : null}

      <form
        className="tts-address"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => window.rascal!.saveTtsSettings({ baseUrl }));
        }}
      >
        <label>
          Service address
          <input id="tts-base" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
        </label>
        <button type="submit" className="ghost">
          Save address
        </button>
      </form>

      <CheckRow
        checked={panel.shortcuts.enabled}
        disabled={busy}
        onChange={(shortcuts) => void run(() => window.rascal!.saveTtsSettings({ shortcuts }))}
      >
        Global shortcuts
      </CheckRow>
      <p className="form-note">{panel.shortcuts.detail}</p>

      {down || !state ? (
        <p className="tts-wait">The queue, now playing, and recent log show up when tts-queue answers on that address.</p>
      ) : (
        <>
          <dl className="tts-status">
            <div><dt>Twitch</dt><dd>{state.status.twitch || "—"}</dd></div>
            <div><dt>YouTube</dt><dd>{state.status.youtube || "—"}</dd></div>
            <div><dt>YouTube subs</dt><dd>{state.status.youtube_subs || "—"}</dd></div>
            <div><dt>Overlays</dt><dd>{state.overlays_connected}</dd></div>
          </dl>

          <article className="tts-now">
            <h3>Now playing</h3>
            {state.current ? <Line platform={state.current.platform} user={state.current.user} text={state.current.text} /> : <p>Idle</p>}
          </article>

          <div className="tts-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void run(() => window.rascal!.ttsCommand("skip"))}>
              Skip
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.ttsCommand("clear"))}>
              Clear
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.ttsCommand(state.paused ? "resume" : "pause"))}>
              {state.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className={state.hold ? "text-button on" : "ghost"}
              aria-pressed={state.hold}
              disabled={busy}
              onClick={() => void run(() => window.rascal!.ttsCommand(state.hold ? "hold-off" : "hold-on"))}
            >
              {state.hold ? "Holding for approval" : "Hold for approval"}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.ttsCommand("approve-next"))}>
              Approve next
            </button>
          </div>

          <div className="tts-columns">
            <section>
              <h3>Queue</h3>
              {state.queue.length === 0 ? <p className="form-note">The play queue is empty.</p> : (
                <ul className="tts-list">
                  {state.queue.map((item) => (
                    <li key={`q-${item.id}`}>
                      <Line platform={item.platform} user={item.user} text={item.text} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>Waiting for approval</h3>
              {state.pending.length === 0 ? <p className="form-note">Nothing is waiting for approval.</p> : (
                <ul className="tts-list">
                  {state.pending.map((item) => (
                    <li key={`p-${item.id}`}>
                      <Line platform={item.platform} user={item.user} text={item.text} />
                      <div className="tts-item-actions">
                        <button type="button" className="primary" disabled={busy} onClick={() => void run(() => window.rascal!.ttsCommand("approve", item.id))}>
                          Approve
                        </button>
                        <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.ttsCommand("reject", item.id))}>
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <form
            className="tts-test"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => window.rascal!.ttsInject({ platform, user: testUser, text: testText }));
            }}
          >
            <h3>Send a test line</h3>
            <div className="custom-offset">
              <label>
                Platform
                <select value={platform} onChange={(event) => setPlatform(event.target.value === "youtube" ? "youtube" : "twitch")}>
                  <option value="twitch">Twitch</option>
                  <option value="youtube">YouTube</option>
                </select>
              </label>
              <label>
                User
                <input value={testUser} onChange={(event) => setTestUser(event.target.value)} />
              </label>
            </div>
            <label>
              Text
              <input value={testText} onChange={(event) => setTestText(event.target.value)} />
            </label>
            <button type="submit" className="ghost" disabled={busy}>
              Queue test line
            </button>
          </form>

          <dl className="tts-stats">
            <div><dt>Accepted</dt><dd>{state.stats.accepted}</dd></div>
            <div><dt>Blocked</dt><dd>{state.stats.blocked}</dd></div>
            <div><dt>Cooldown</dt><dd>{state.stats.cooldown}</dd></div>
            <div><dt>Played</dt><dd>{state.stats.played}</dd></div>
            <div><dt>Skipped</dt><dd>{state.stats.skipped}</dd></div>
            <div><dt>Expired</dt><dd>{state.stats.expired}</dd></div>
            <div><dt>Failed</dt><dd>{state.stats.failed}</dd></div>
          </dl>

          <section className="tts-recent">
            <h3>Recent</h3>
            {state.recent.length === 0 ? <p className="form-note">No recent lines.</p> : (
              <ul>
                {state.recent.map((item, index) => (
                  <li key={`${item.t}-${index}`}>
                    <span>{item.t}</span>
                    <strong>{item.result || "line"}</strong>
                    <em>{[item.platform, item.user].filter(Boolean).join(" · ")}</em>
                    <p>{item.text}</p>
                    {item.reason ? <small>{item.reason}</small> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function Line({ platform, user, text }: { platform: string; user: string; text: string }) {
  const who = [platform, user].filter(Boolean).join(" · ");
  return (
    <p className="tts-line">
      {who ? <strong>{who}</strong> : null}
      <span>{text || "—"}</span>
    </p>
  );
}
