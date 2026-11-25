import { useEffect, useRef, useState, type ReactNode } from "react";
import { brand } from "../../shared/brand";
import type { BotSnapshot } from "../../shared/api";
import type { YoutubeDeskState } from "../../main/youtube/desk";
import { defaultShoutout, defaultThanks, type ShoutoutSettings, type ThanksSettings } from "../../../packages/bot/src/model";
import { checksFromTarget, targetFromChecks, type PlatformTarget } from "../../shared/platform/target";
import { CheckRow } from "./CheckRow";

const THANK_ROWS: { key: keyof ThanksSettings; label: string }[] = [
  { key: "follow", label: "Follow" },
  { key: "sub", label: "Subscription" },
  { key: "resub", label: "Resubscription" },
  { key: "subgift", label: "Gifted sub" },
  { key: "cheer", label: "Cheer" },
  { key: "raid", label: "Raid" },
  { key: "redemption", label: "Channel point redeem" },
];

const EMPTY: BotSnapshot = {
  connected: false,
  status: "Starting the bot…",
  botLogin: null,
  channelLogin: "",
  broadcasterId: "",
  portalUrl: "",
  redirectUri: "",
  login: null,
  commands: [],
  timers: [],
  filters: {
    blacklist: [],
    whitelist: [],
    links: { enabled: false, action: "delete", timeoutSec: 30 },
    caps: { enabled: false, minLength: 20, maxPercent: 80, action: "delete", timeoutSec: 30 },
    symbols: { enabled: false, minLength: 20, maxPercent: 70, action: "delete", timeoutSec: 30 },
    permitSec: 60,
    platforms: "twitch",
  },
  log: [],
  seJwtSet: false,
  askJeevesHook: false,
  platforms: [],
  youtubeLogin: null,
  youtubeRedirectUri: "http://127.0.0.1:4799/youtube/callback",
  googleClientId: "",
  googleClientSecretSet: false,
  googleClientFromEnv: false,
  youtubeApiPoll: false,
  quotes: [],
  thanks: defaultThanks(),
  shoutout: defaultShoutout(),
};

const EMPTY_DESK: YoutubeDeskState = {
  connected: false,
  account: null,
  channelId: null,
  status: "",
  login: null,
  purpose: null,
};

export function BotView() {
  const [state, setState] = useState<BotSnapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [response, setResponse] = useState("Hello {user} ({count})");
  const [level, setLevel] = useState("everyone");
  const [cooldown, setCooldown] = useState("5");
  const [words, setWords] = useState("");
  const [jwt, setJwt] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"embedded" | "server">("embedded");
  const [desk, setDesk] = useState<YoutubeDeskState>(EMPTY_DESK);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [commandTwitch, setCommandTwitch] = useState(true);
  const [commandYoutube, setCommandYoutube] = useState(false);
  const [keywords, setKeywords] = useState("");
  const [thanks, setThanks] = useState<ThanksSettings>(defaultThanks());
  const [shoutout, setShoutout] = useState<ShoutoutSettings>(defaultShoutout());
  const [quoteImport, setQuoteImport] = useState("");
  const extrasReady = useRef(false);
  const seeded = useRef(false);
  const clientSeeded = useRef(false);

  async function refresh(): Promise<void> {
    if (!window.rascal) return;
    const [next, youtube] = await Promise.all([window.rascal.botState(), window.rascal.youtubeDeskState()]);
    setState(next);
    setDesk(youtube);
    if (!extrasReady.current) {
      extrasReady.current = true;
      setThanks(next.thanks);
      setShoutout(next.shoutout);
    }
  }

  useEffect(() => {
    void window.rascal?.botLink().then((link) => setMode(link.mode));
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Bot is unavailable."));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh().catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (seeded.current || state.status === "Starting the bot…") return;
    seeded.current = true;
    setWords(state.filters.blacklist.map((item) => `${item.word}, ${item.action}, ${item.timeoutSec}`).join("\n"));
  }, [state.filters, state.status]);

  useEffect(() => {
    if (clientSeeded.current || !state.googleClientId) return;
    clientSeeded.current = true;
    setClientId(state.googleClientId);
  }, [state.googleClientId]);

  async function run(work: () => Promise<BotSnapshot>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setState(await work());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That bot change failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const twitch = state.platforms.find((platform) => platform.id === "twitch");
  const youtube = state.platforms.find((platform) => platform.id === "youtube");
  const youtubeLogin = state.youtubeLogin ?? (desk.purpose === "bot" ? desk.login : null);

  return (
    <section className="bot-page">
      <header className="redeem-bar">
        <div>
          <h2>Bot</h2>
          <p>Commands, timers, and filters can run on Twitch, YouTube, or both. Ask Jeeves stays in tts-queue.</p>
        </div>
        <p className={state.connected ? "tts-up" : "tts-down"}>{state.connected ? `Connected as ${state.botLogin}` : "Not connected"}</p>
      </header>
      <p>{mode === "server" ? "Server mode. This window talks to the Fly bot and does not run a local one." : "Embedded mode. The bot is running on this computer."}</p>
      <p>{state.status}</p>
      {error ? <p className="form-error">{error}</p> : null}
      {state.login ? (
        <div className="banner">
          <p>
            Approve <strong>{state.login.userCode}</strong> at {state.login.verificationUri}. Use the bot account, not your broadcaster login.
          </p>
        </div>
      ) : null}
      <div className="tts-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void run(() => window.rascal!.botLogin())}>
          Connect bot account
        </button>
        <button type="button" className="ghost" disabled={busy || !state.botLogin} onClick={() => void run(() => window.rascal!.botLogout())}>
          Log out bot
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            void window.rascal?.botExport().then((config) => {
              const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
              const link = document.createElement("a");
              link.href = URL.createObjectURL(blob);
              link.download = brand.exportFile;
              link.click();
            });
          }}
        >
          Download config
        </button>
        <a href={state.portalUrl || "#"} onClick={(event) => event.preventDefault()}>
          <button type="button" className="ghost" disabled={!state.portalUrl} onClick={() => void window.rascal?.openExternal(state.portalUrl)}>
            Open mod portal
          </button>
        </a>
      </div>
      <p className="form-note">
        Portal: {state.portalUrl || "http://localhost:4788/portal"}. Add this redirect to the Twitch application: {state.redirectUri || "http://localhost:4788/portal/callback"}. Then /mod the bot account in your channel.
      </p>

      <PlatformCard
        title="Twitch"
        status={twitch?.status || state.status}
        connected={twitch?.connected ?? state.connected}
        account={twitch?.account ?? state.botLogin}
        accountMode={twitch?.accountMode ?? "bot"}
        busy={busy}
        onMode={(channel) => void run(() => window.rascal!.botSaveAccounts({ twitch: channel ? "channel" : "bot" }))}
      >
        <p className="form-note">A separate bot account is the usual choice. Post as the signed-in channel only when that login should speak for the bot.</p>
      </PlatformCard>

      <PlatformCard
        title="YouTube"
        status={youtube?.status || "YouTube bot is idle."}
        connected={youtube?.connected ?? false}
        account={youtube?.account ?? null}
        accountMode={youtube?.accountMode ?? "bot"}
        busy={busy}
        onMode={(channel) => void run(() => window.rascal!.botSaveAccounts({ youtube: channel ? "channel" : "bot" }))}
      >
        <p className="form-note">
          Redirect URI for the Google client: {state.youtubeRedirectUri}. Channel account: {desk.account || "not connected"}. {desk.status}
        </p>
        {desk.login && desk.purpose === "desk" ? (
          <div className="banner">
            <p>Approve YouTube for the channel account in the browser.</p>
            <button type="button" className="primary" onClick={() => void window.rascal?.openExternal(desk.login!.verificationUri)}>
              Open Google
            </button>
          </div>
        ) : null}
        {youtubeLogin ? (
          <div className="banner">
            <p>Approve YouTube for the bot account in the browser.</p>
            <button type="button" className="primary" onClick={() => void window.rascal?.openExternal(youtubeLogin.verificationUri)}>
              Open Google
            </button>
          </div>
        ) : null}
        <div className="tts-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => { await window.rascal!.youtubeConnect(); return window.rascal!.botState(); })}>
            Connect channel account
          </button>
          <button type="button" className="ghost" disabled={busy || !desk.connected} onClick={() => void run(async () => { await window.rascal!.youtubeLogout(); return window.rascal!.botState(); })}>
            Log out channel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void run(() => window.rascal!.botYoutubeLogin())}>
            Connect bot account
          </button>
          <button type="button" className="ghost" disabled={busy || !youtube?.separateAccount} onClick={() => void run(() => window.rascal!.botYoutubeLogout())}>
            Log out bot account
          </button>
        </div>
        <label>
          Google client ID
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={state.googleClientFromEnv ? "Using RASCAL_GOOGLE_CLIENT_ID" : "apps.googleusercontent.com"} autoComplete="off" />
        </label>
        <label>
          Google client secret
          <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder={state.googleClientSecretSet ? "A secret is already stored" : "Paste the client secret"} autoComplete="off" />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => void run(() => window.rascal!.botSaveGoogleClient({ clientId, clientSecret })).then(() => setClientSecret(""))}
        >
          Save Google client
        </button>
        <CheckRow
          checked={state.youtubeApiPoll}
          disabled={busy}
          onChange={(enabled) => void run(() => window.rascal!.botSaveAccounts({ youtubeApiPoll: enabled }))}
        >
          Also poll live chat with the Data API
        </CheckRow>
        <p className="form-note">Leave this off. The page reader does not use quota. A 5-hour Data API poll at 5 seconds spends more than the daily quota. It turns on by itself only if the page reader fails three times in a row.</p>
        <QuotaMeter quota={youtube?.quota ?? null} />
      </PlatformCard>

      <section className="bot-card">
        <h3>Commands</h3>
        <ul className="tts-list">
          {state.commands.length === 0 ? <li>No custom commands yet. Built-ins: !permit, !timeout, !ban, !unban, !commands, !cmds, !followage, !accountage, !so, !quote.</li> : null}
          {state.commands.map((command) => (
            <li key={command.id}>
              <p className="tts-line">
                <strong>!{command.name}</strong>
                <span>
                  {command.level} · {platformLabel(command.platforms)} · {command.count} uses · {command.cooldownSec}s
                </span>
              </p>
              <PlatformChecks
                target={command.platforms}
                disabled={busy}
                onChange={(platforms) => void run(() => window.rascal!.botSaveCommand({ ...command, platforms }))}
              />
              <p>{command.response}</p>
              {command.keywords && command.keywords.length > 0 ? <p className="form-note">Keywords: {command.keywords.join(", ")}</p> : null}
              <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.botDeleteCommand(command.id))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="custom-offset">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="so" />
          </label>
          <label>
            Who can use it
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="everyone">Everyone</option>
              <option value="sub">Subscriber</option>
              <option value="vip">VIP</option>
              <option value="mod">Moderator</option>
              <option value="broadcaster">Broadcaster</option>
            </select>
          </label>
          <label>
            Cooldown seconds
            <input value={cooldown} onChange={(event) => setCooldown(event.target.value)} />
          </label>
        </div>
        <label>
          Keywords
          <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="alot, on accident, deez nutz" />
        </label>
        <label>
          Response
          <textarea value={response} onChange={(event) => setResponse(event.target.value)} />
        </label>
        <PlatformChecks target={targetFromChecks(commandTwitch, commandYoutube)} disabled={busy} onChange={(platforms) => { const next = checksFromTarget(platforms); setCommandTwitch(next.twitch); setCommandYoutube(next.youtube); }} />
        <p className="form-note">
          A keyword fires when that word or phrase appears in a normal message. The cooldown above stops it repeating. Variables: {"{user}"} {"{touser}"} {"{1}"} {"{count}"} {"{uptime}"} {"{game}"} {"{title}"} {"{followage}"} {"{random.chatter}"} {"{random:yes|no}"} {"{random:{user} is better|{touser} is better}"}
        </p>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(() =>
              window.rascal!.botSaveCommand({
                name,
                response,
                level,
                keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean),
                cooldownSec: Number(cooldown) || 0,
                userCooldownSec: 15,
                enabled: true,
                platforms: targetFromChecks(commandTwitch, commandYoutube),
              }),
            )
          }
        >
          Save command
        </button>
      </section>

      <section className="bot-card">
        <h3>Shoutout</h3>
        <p className="form-note">Mods use !so username. Rascal posts this line with the target's login and the game Helix last had on their channel. A custom !so still works for viewers who are not mods.</p>
        <label>
          Shoutout line
          <textarea value={shoutout.template} onChange={(event) => setShoutout({ ...shoutout, template: event.target.value })} />
        </label>
        <CheckRow checked={shoutout.helix} disabled={busy} onChange={(helix) => setShoutout({ ...shoutout, helix })}>
          Also send a Twitch shoutout when the bot token has moderator:manage:shoutouts
        </CheckRow>
        <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.botSaveExtras({ shoutout }))}>
          Save shoutout
        </button>
      </section>

      <section className="bot-card">
        <h3>Quotes</h3>
        <p className="form-note">Everyone can use !quote or !quote 3. Mods can !quote add text and !quote remove 3. Numbers stay put after a removal.</p>
        <ul className="tts-list">
          {state.quotes.length === 0 ? <li>No quotes yet.</li> : null}
          {state.quotes.map((quote) => (
            <li key={quote.id}>
              <p className="tts-line">
                <strong>#{quote.id}</strong>
                <span>{quote.by}</span>
              </p>
              <p>{quote.text}</p>
            </li>
          ))}
        </ul>
        <label>
          Import quotes, one JSON list
          <textarea value={quoteImport} onChange={(event) => setQuoteImport(event.target.value)} placeholder='["first quote", {"text": "second"}]' />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            try {
              const quotes = JSON.parse(quoteImport) as unknown;
              if (!Array.isArray(quotes)) {
                setError("Paste a JSON list of quotes.");
                return;
              }
              void run(() => window.rascal!.botSaveExtras({ quotes })).then(() => setQuoteImport(""));
            } catch {
              setError("That quote list could not be read.");
            }
          }}
        >
          Import quotes
        </button>
      </section>

      <section className="bot-card">
        <h3>Chat thank-yous</h3>
        <p className="form-note">
          Off until you turn one on. The bot account posts the line when that notice is shown in chat. A hidden notice, or a duplicate Rascal already dropped, does not get a thank-you. Gifted subs from the same person a few seconds apart become one line.
        </p>
        {THANK_ROWS.map((row) => (
          <div key={row.key}>
            <CheckRow
              checked={thanks[row.key].enabled}
              disabled={busy}
              onChange={(enabled) => setThanks({ ...thanks, [row.key]: { ...thanks[row.key], enabled } })}
            >
              {row.label}
            </CheckRow>
            <label>
              {row.label} line
              <input
                value={thanks[row.key].template}
                onChange={(event) => setThanks({ ...thanks, [row.key]: { ...thanks[row.key], template: event.target.value } })}
              />
            </label>
          </div>
        ))}
        <p className="form-note">Variables: {"{user}"} {"{amount}"} {"{count}"}</p>
        <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.botSaveExtras({ thanks }))}>
          Save thank-yous
        </button>
      </section>

      <section className="bot-card">
        <h3>Timers</h3>
        <p className="form-note">
          A timer can run while the stream is live, while it is offline, or both. Each side has its own interval and chat-line minimum. Put one message per line and Rascal rotates through them. Live and offline come from Twitch and, when the page reader has an answer, from YouTube. YouTube only posts while that channel is live.
        </p>
        {state.timers.map((timer) => (
          <TimerEditor
            key={timer.id}
            timer={timer}
            busy={busy}
            onSave={(input) => run(() => window.rascal!.botSaveTimer(input))}
            onDelete={() => run(() => window.rascal!.botDeleteTimer(timer.id))}
          />
        ))}
        <h3>New timer</h3>
        <TimerEditor busy={busy} timer={null} onSave={(input) => run(() => window.rascal!.botSaveTimer(input))} />
      </section>

      <section className="bot-card">
        <h3>Filters</h3>
        <PlatformChecks
          target={state.filters.platforms}
          disabled={busy}
          onChange={(platforms) => void run(() => window.rascal!.botSaveFilters({ platforms }))}
        />
        <CheckRow
          checked={state.filters.links.enabled}
          onChange={(enabled) => void run(() => window.rascal!.botSaveFilters({ links: { enabled, action: "delete", timeoutSec: 30 } }))}
        >
          Delete links unless a mod used !permit
        </CheckRow>
        <CheckRow
          checked={state.filters.caps.enabled}
          onChange={(enabled) => void run(() => window.rascal!.botSaveFilters({ caps: { ...state.filters.caps, enabled } }))}
        >
          Caps limit ({state.filters.caps.maxPercent}% after {state.filters.caps.minLength} letters)
        </CheckRow>
        <CheckRow
          checked={state.filters.symbols.enabled}
          onChange={(enabled) => void run(() => window.rascal!.botSaveFilters({ symbols: { ...state.filters.symbols, enabled } }))}
        >
          Symbol spam limit
        </CheckRow>
        <label>
          Blacklist, one per line: word, delete|timeout|ban, seconds
          <textarea value={words} onChange={(event) => setWords(event.target.value)} />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            const blacklist = words
              .split(/\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [word, action, seconds] = line.split(",").map((part) => part.trim());
                return { word, action: action === "timeout" || action === "ban" ? action : "delete", timeoutSec: Number(seconds) || 60 };
              });
            void run(() => window.rascal!.botSaveFilters({ blacklist }));
          }}
        >
          Save blacklist
        </button>
      </section>

      <section className="bot-card">
        <h3>Import</h3>
        <label>
          StreamElements JWT
          <input type="password" value={jwt} autoComplete="off" onChange={(event) => setJwt(event.target.value)} placeholder={state.seJwtSet ? "A JWT is already stored" : "Paste the channel JWT"} />
        </label>
        <button type="button" className="primary" disabled={busy || (!jwt.trim() && !state.seJwtSet)} onClick={() => void run(() => window.rascal!.botImportSe(jwt)).then(() => setJwt(""))}>
          Import commands and timers
        </button>
        <p className="form-note">{state.seJwtSet ? "Leave the field blank to import again with the stored JWT. Pasting a new one replaces it." : "The JWT is stored on this computer and is not shown again."}</p>
        <label>
          JSON import
          <textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder='{"commands":[{"name":"so","response":"Go see {touser}"}]}' />
          <span className="hint">
            Paste {brand.exportFile}. An older {brand.legacyExportFile} uses the same shape and imports the same way.
          </span>
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            try {
              void run(() => window.rascal!.botImportJson(JSON.parse(jsonText) as unknown));
            } catch {
              setError("That JSON could not be read.");
            }
          }}
        >
          Import JSON
        </button>
      </section>

      <section className="bot-card">
        <h3>Mod log</h3>
        <ul className="tts-recent">
          {state.log.length === 0 ? <li>No bot actions yet.</li> : null}
          {state.log.slice().reverse().map((entry, index) => (
            <li key={`${entry.t}-${index}`}>
              <strong>{entry.action}</strong> <em>{entry.user}</em>
              <p>{entry.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

type SavedTimer = BotSnapshot["timers"][number];

interface TimerDraft {
  name: string;
  messagesText: string;
  mode: SavedTimer["mode"];
  intervalSec: string;
  minChatLines: string;
  offlineIntervalSec: string;
  offlineMinChatLines: string;
  enabled: boolean;
  twitch: boolean;
  youtube: boolean;
}

function blankTimerDraft(): TimerDraft {
  return {
    name: "",
    messagesText: "{title} is live",
    mode: "live",
    intervalSec: "600",
    minChatLines: "5",
    offlineIntervalSec: "1800",
    offlineMinChatLines: "5",
    enabled: true,
    twitch: true,
    youtube: false,
  };
}

function draftFromTimer(timer: SavedTimer): TimerDraft {
  const checks = checksFromTarget(timer.platforms);
  const messages = timer.messages.length > 0 ? timer.messages : timer.message ? [timer.message] : [];
  return {
    name: timer.name,
    messagesText: messages.join("\n"),
    mode: timer.mode,
    intervalSec: String(timer.intervalSec),
    minChatLines: String(timer.minChatLines),
    offlineIntervalSec: String(timer.offlineIntervalSec),
    offlineMinChatLines: String(timer.offlineMinChatLines),
    enabled: timer.enabled,
    twitch: checks.twitch,
    youtube: checks.youtube,
  };
}

function timerSignature(timer: SavedTimer): string {
  return [
    timer.id,
    timer.name,
    timer.enabled,
    timer.mode,
    timer.intervalSec,
    timer.minChatLines,
    timer.offlineIntervalSec,
    timer.offlineMinChatLines,
    timer.platforms,
    ...timer.messages,
  ].join("\u0001");
}

function TimerEditor({
  timer,
  busy,
  onSave,
  onDelete,
}: {
  timer: SavedTimer | null;
  busy: boolean;
  onSave: (input: Record<string, unknown>) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<TimerDraft>(() => (timer ? draftFromTimer(timer) : blankTimerDraft()));
  const [dirty, setDirty] = useState(false);
  const signature = timer ? timerSignature(timer) : "";
  const seen = useRef(signature);
  useEffect(() => {
    if (!timer || dirty || seen.current === signature) return;
    seen.current = signature;
    setDraft(draftFromTimer(timer));
  }, [timer, signature, dirty]);

  function edit(patch: Partial<TimerDraft>): void {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  }

  const messages = draft.messagesText
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  const showLive = draft.mode !== "offline";
  const showOffline = draft.mode !== "live";

  return (
    <div className="timer-editor">
      {timer ? (
        <p className="tts-line">
          <strong>{timer.name}</strong>
          <span>
            {timer.enabled ? "On" : "Off"} · next: {timer.message || "none"} · {timer.messages.length} message{timer.messages.length === 1 ? "" : "s"}
          </span>
        </p>
      ) : null}
      <div className="custom-offset">
        <label>
          Name
          <input value={draft.name} onChange={(event) => edit({ name: event.target.value })} />
        </label>
        <label>
          When
          <select value={draft.mode} onChange={(event) => edit({ mode: event.target.value as TimerDraft["mode"] })}>
            <option value="live">Only while live</option>
            <option value="offline">Only while offline</option>
            <option value="both">Live and offline</option>
          </select>
        </label>
      </div>
      {showLive ? (
        <div className="custom-offset">
          <label>
            Live interval seconds
            <input value={draft.intervalSec} onChange={(event) => edit({ intervalSec: event.target.value })} />
          </label>
          <label>
            Live min chat lines
            <input value={draft.minChatLines} onChange={(event) => edit({ minChatLines: event.target.value })} />
          </label>
        </div>
      ) : null}
      {showOffline ? (
        <div className="custom-offset">
          <label>
            Offline interval seconds
            <input value={draft.offlineIntervalSec} onChange={(event) => edit({ offlineIntervalSec: event.target.value })} />
          </label>
          <label>
            Offline min chat lines
            <input value={draft.offlineMinChatLines} onChange={(event) => edit({ offlineMinChatLines: event.target.value })} />
          </label>
        </div>
      ) : null}
      <PlatformChecks
        target={targetFromChecks(draft.twitch, draft.youtube)}
        disabled={busy}
        onChange={(platforms) => {
          const next = checksFromTarget(platforms);
          edit({ twitch: next.twitch, youtube: next.youtube });
        }}
      />
      <CheckRow checked={draft.enabled} disabled={busy} onChange={(enabled) => edit({ enabled })}>
        Enabled
      </CheckRow>
      <label>
        Messages, one per line
        <textarea value={draft.messagesText} onChange={(event) => edit({ messagesText: event.target.value })} />
      </label>
      <div className="tts-actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            void onSave({
              ...(timer ? { id: timer.id } : {}),
              name: draft.name,
              messages,
              message: messages[0] ?? "",
              mode: draft.mode,
              intervalSec: Number(draft.intervalSec) || 600,
              minChatLines: Number(draft.minChatLines) || 0,
              offlineIntervalSec: Number(draft.offlineIntervalSec) || 1800,
              offlineMinChatLines: Number(draft.offlineMinChatLines) || 0,
              enabled: draft.enabled,
              platforms: targetFromChecks(draft.twitch, draft.youtube),
            }).then((ok) => {
              if (!ok) return;
              setDirty(false);
              if (!timer) setDraft(blankTimerDraft());
            });
          }}
        >
          {timer ? "Save timer" : "Add timer"}
        </button>
        {onDelete ? (
          <button type="button" className="ghost" disabled={busy} onClick={() => void onDelete()}>
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PlatformCard({
  title,
  status,
  connected,
  account,
  accountMode,
  busy,
  onMode,
  children,
}: {
  title: string;
  status: string;
  connected: boolean;
  account: string | null;
  accountMode: "channel" | "bot";
  busy: boolean;
  onMode: (channel: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="bot-card">
      <h3>{title}</h3>
      <p className={connected ? "tts-up" : "tts-down"}>{connected ? "Connected" : "Not connected"}</p>
      <p>{status}</p>
      <p>Posts as {account || "nobody yet"}.</p>
      <CheckRow checked={accountMode === "channel"} disabled={busy} onChange={onMode}>
        Post as the signed-in channel instead of a separate bot account
      </CheckRow>
      {children}
    </section>
  );
}

function PlatformChecks({
  target,
  disabled,
  onChange,
}: {
  target: PlatformTarget | undefined;
  disabled: boolean;
  onChange: (target: PlatformTarget) => void;
}) {
  const checks = checksFromTarget(target);
  return (
    <div className="composer-targets">
      <CheckRow
        checked={checks.twitch}
        disabled={disabled}
        onChange={(twitch) => onChange(targetFromChecks(twitch, twitch ? checks.youtube : checks.youtube || true))}
      >
        Twitch
      </CheckRow>
      <CheckRow
        checked={checks.youtube}
        disabled={disabled}
        onChange={(youtube) => onChange(targetFromChecks(youtube ? checks.twitch : checks.twitch || true, youtube))}
      >
        YouTube
      </CheckRow>
    </div>
  );
}

function QuotaMeter({ quota }: { quota: { usedUnits: number; dailyLimit: number; state: string; detail: string } | null }) {
  if (!quota) return null;
  const width = Math.min(100, Math.round((quota.usedUnits / Math.max(1, quota.dailyLimit)) * 100));
  return (
    <div>
      <p>{quota.detail}</p>
      <div className="quota-meter" aria-label={`YouTube quota ${quota.state}`}>
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function platformLabel(target: PlatformTarget | undefined): string {
  if (target === "all") return "Twitch and YouTube";
  if (target === "youtube") return "YouTube";
  return "Twitch";
}
