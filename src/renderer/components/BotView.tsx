import { useEffect, useRef, useState } from "react";
import { brand } from "../../shared/brand";
import type { BotSnapshot } from "../../shared/api";
import type { YoutubeDeskState } from "../../shared/youtube/desk-state";
import { defaultShoutout, defaultThanks, type ShoutoutSettings, type ThanksSettings } from "../../../packages/bot/src/model";
import { checksFromTarget, targetFromChecks } from "../../shared/platform/target";
import { CheckRow } from "./CheckRow";
import { BotHooks } from "./bot-hooks";
import { BotLibrary } from "./bot-library";
import { PlatformCard, PlatformChecks, QuotaMeter, platformLabel } from "./bot-editors";

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
  platforms: [],
  youtubeLogin: null,
  youtubeRedirectUri: "http://127.0.0.1:4799/youtube/callback",
  googleClientId: "",
  googleClientSecretSet: false,
  googleClientFromEnv: false,
  youtubeApiPoll: false,
  quotes: [],
  hooks: [],
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
  const [hookName, setHookName] = useState("");
  const [hookTrigger, setHookTrigger] = useState("ask");
  const [hookKeywords, setHookKeywords] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [hookSecret, setHookSecret] = useState("");
  const [hookTimeout, setHookTimeout] = useState("5000");
  const [hookCooldown, setHookCooldown] = useState("5");
  const [hookUserCooldown, setHookUserCooldown] = useState("15");
  const [hookLevel, setHookLevel] = useState("everyone");
  const [hookReply, setHookReply] = useState<"none" | "chat">("none");
  const [hookEnabled, setHookEnabled] = useState(false);
  const [hookAllowBroadcaster, setHookAllowBroadcaster] = useState(false);
  const [hookId, setHookId] = useState("");
  const [hookNote, setHookNote] = useState("");
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
          <p>Commands, timers, and filters can run on Twitch, YouTube, or both.</p>
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


      <BotHooks
        state={state}
        busy={busy}
        run={run}
        hookName={hookName} setHookName={setHookName}
        hookTrigger={hookTrigger} setHookTrigger={setHookTrigger}
        hookKeywords={hookKeywords} setHookKeywords={setHookKeywords}
        hookUrl={hookUrl} setHookUrl={setHookUrl}
        hookSecret={hookSecret} setHookSecret={setHookSecret}
        hookTimeout={hookTimeout} setHookTimeout={setHookTimeout}
        hookCooldown={hookCooldown} setHookCooldown={setHookCooldown}
        hookUserCooldown={hookUserCooldown} setHookUserCooldown={setHookUserCooldown}
        hookLevel={hookLevel} setHookLevel={setHookLevel}
        hookReply={hookReply} setHookReply={setHookReply}
        hookEnabled={hookEnabled} setHookEnabled={setHookEnabled}
        hookAllowBroadcaster={hookAllowBroadcaster} setHookAllowBroadcaster={setHookAllowBroadcaster}
        hookId={hookId} setHookId={setHookId}
        hookNote={hookNote} setHookNote={setHookNote}
      />
      <BotLibrary
        state={state}
        busy={busy}
        run={run}
        setError={setError}
        shoutout={shoutout}
        setShoutout={setShoutout}
        quoteImport={quoteImport}
        setQuoteImport={setQuoteImport}
        thanks={thanks}
        setThanks={setThanks}
        words={words}
        setWords={setWords}
        jwt={jwt}
        setJwt={setJwt}
        jsonText={jsonText}
        setJsonText={setJsonText}
      />
    </section>
  );
}
