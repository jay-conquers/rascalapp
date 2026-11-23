import { useEffect, useRef, useState, type ReactNode } from "react";
import { brand } from "../../shared/brand";
import type { BotSnapshot } from "../../shared/api";
import type { YoutubeDeskState } from "../../main/youtube/desk";
import { checksFromTarget, targetFromChecks, type PlatformTarget } from "../../shared/platform/target";
import { CheckRow } from "./CheckRow";

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
  const [timerName, setTimerName] = useState("");
  const [timerMessage, setTimerMessage] = useState("{title} is live");
  const [timerEvery, setTimerEvery] = useState("600");
  const [timerLines, setTimerLines] = useState("5");
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
  const [timerTwitch, setTimerTwitch] = useState(true);
  const [timerYoutube, setTimerYoutube] = useState(false);
  const seeded = useRef(false);
  const clientSeeded = useRef(false);

  async function refresh(): Promise<void> {
    if (!window.rascal) return;
    const [next, youtube] = await Promise.all([window.rascal.botState(), window.rascal.youtubeDeskState()]);
    setState(next);
    setDesk(youtube);
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

  async function run(work: () => Promise<BotSnapshot>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setState(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : "That bot change failed.");
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
          {state.commands.length === 0 ? <li>No custom commands yet. Built-ins: !permit, !timeout, !ban, !unban, !commands.</li> : null}
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
          Response
          <textarea value={response} onChange={(event) => setResponse(event.target.value)} />
        </label>
        <PlatformChecks target={targetFromChecks(commandTwitch, commandYoutube)} disabled={busy} onChange={(platforms) => { const next = checksFromTarget(platforms); setCommandTwitch(next.twitch); setCommandYoutube(next.youtube); }} />
        <p className="form-note">Variables: {"{user}"} {"{touser}"} {"{count}"} {"{uptime}"} {"{game}"} {"{title}"} {"{followage}"} {"{random:yes|no}"}</p>
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
        <h3>Timers</h3>
        <ul className="tts-list">
          {state.timers.map((timer) => (
            <li key={timer.id}>
              <p className="tts-line">
                <strong>{timer.name}</strong>
                <span>
                  {platformLabel(timer.platforms)} · every {timer.intervalSec}s after {timer.minChatLines} lines
                </span>
              </p>
              <PlatformChecks
                target={timer.platforms}
                disabled={busy}
                onChange={(platforms) => void run(() => window.rascal!.botSaveTimer({ ...timer, platforms }))}
              />
              <p>{timer.message}</p>
              <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.botDeleteTimer(timer.id))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="custom-offset">
          <label>
            Name
            <input value={timerName} onChange={(event) => setTimerName(event.target.value)} />
          </label>
          <label>
            Interval seconds
            <input value={timerEvery} onChange={(event) => setTimerEvery(event.target.value)} />
          </label>
          <label>
            Min chat lines
            <input value={timerLines} onChange={(event) => setTimerLines(event.target.value)} />
          </label>
        </div>
        <PlatformChecks target={targetFromChecks(timerTwitch, timerYoutube)} disabled={busy} onChange={(platforms) => { const next = checksFromTarget(platforms); setTimerTwitch(next.twitch); setTimerYoutube(next.youtube); }} />
        <label>
          Message
          <textarea value={timerMessage} onChange={(event) => setTimerMessage(event.target.value)} />
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(() =>
              window.rascal!.botSaveTimer({
                name: timerName,
                message: timerMessage,
                intervalSec: Number(timerEvery) || 600,
                minChatLines: Number(timerLines) || 0,
                enabled: true,
                platforms: targetFromChecks(timerTwitch, timerYoutube),
              }),
            )
          }
        >
          Save timer
        </button>
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
        <button type="button" className="primary" disabled={busy || !jwt.trim()} onClick={() => void run(() => window.rascal!.botImportSe(jwt)).then(() => setJwt(""))}>
          Import commands and timers
        </button>
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
