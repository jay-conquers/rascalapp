import { useEffect, useState } from "react";
import type { SettingsPatch } from "../../shared/api";
import { brand } from "../../shared/brand";
import { NOTICE_LABELS, type FeedToggles, type NoticeKind } from "../../shared/feed-toggles";
import { defaultChatAlert, type ChatAlertSettings } from "../../shared/chat-alert";
import { TABS_SUMMARY, setTabShown, tabsPlatformSummary } from "../../shared/desk-tabs";
import { isPlatformEnabled, enableKick, requestPlatformToggle } from "../../shared/platform/selection";
import { kickRelayStatus } from "../../shared/kick/protocol";
import { KICK_RELAY_DOCS_URL } from "../../shared/kick/docs";
import { KICK_TITLE_RELOGIN } from "../../shared/kick/channel";
import type { KickDeskState } from "../../shared/kick/desk-state";
import { KickRelayDialog } from "./KickRelayNotice";
import { playChatChime } from "../chat-sound";
import { CHATTER_SCOPE, MODERATE_MANAGE_SCOPES, MODERATE_READ_SCOPES } from "../../shared/scopes";
import { CheckRow } from "./CheckRow";
import { TabPicker } from "./DeskTabs";
import { PlatformPicker } from "./PlatformPicker";
import type { AuthState, ConnectionStatus, Settings } from "../../shared/types";

const SCOPE_REASONS = [
  ["chat:read", "Read chat while logged in"],
  ["chat:edit", "Send chat over IRC if needed"],
  ["user:write:chat", "Send chat from this desk"],
  ["user:read:chat", "EventSub notices: subs, raids, watch streaks, mod anniversaries"],
  ["channel:manage:broadcast", "Change title, category, and tags"],
  ["channel:read:redemptions", "Hear channel point redeems"],
  ["channel:manage:redemptions", "Create rewards this app owns"],
  ["moderator:read:followers", "Show new follows in the desk"],
  [MODERATE_MANAGE_SCOPES[0], "Delete a chat message from this desk"],
  [MODERATE_MANAGE_SCOPES[1], "Timeout, ban, and unban from this desk"],
  [CHATTER_SCOPE, "Suggest Twitch chatters when you type @"],
  ...MODERATE_READ_SCOPES.map((scope) => [scope, "Private mod log (channel.moderate)"] as const),
] as const;

export function SettingsView({
  settings,
  auth,
  status,
  version,
  onSave,
  onLogin,
  onLogout,
  onOpenConsole,
}: {
  settings: Settings;
  auth: AuthState;
  status: ConnectionStatus;
  version: string;
  onSave: (patch: SettingsPatch) => Promise<void>;
  onLogin: () => void;
  onLogout: () => void;
  onOpenConsole: () => void;
}) {
  const [clientId, setClientId] = useState(settings.twitchClientId);
  const [channel, setChannel] = useState(settings.twitchChannel);
  const [youtube, setYoutube] = useState(settings.youtubeChannelId);
  const [kickUrl, setKickUrl] = useState(settings.kickRelayUrl);
  const [kickSecret, setKickSecret] = useState("");
  const [kickClientId, setKickClientId] = useState("");
  const [kickClientSecret, setKickClientSecret] = useState("");
  const [kickDesk, setKickDesk] = useState<KickDeskState | null>(null);
  const [kickNotice, setKickNotice] = useState(false);
  const [port, setPort] = useState(String(settings.overlayPort));
  const [autoImport, setAutoImport] = useState(settings.autoImportFirebot !== false);
  const [feed, setFeed] = useState<FeedToggles>(settings.feed);
  const [alert, setAlert] = useState<ChatAlertSettings>(settings.chatAlert ?? defaultChatAlert());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [botMode, setBotMode] = useState<"embedded" | "server">("embedded");
  const [botUrl, setBotUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [botTokenSet, setBotTokenSet] = useState(false);
  const [botNote, setBotNote] = useState<string | null>(null);

  useEffect(() => {
    void window.rascal?.botLink().then((link) => {
      setBotMode(link.mode);
      setBotUrl(link.serverUrl);
      setBotTokenSet(link.tokenSet);
    });
  }, []);

  async function saveBotConnection(): Promise<void> {
    setBusy(true);
    setError(null);
    setBotNote(null);
    try {
      const saved = await window.rascal!.saveBotLink({
        mode: botMode,
        serverUrl: botUrl,
        adminToken: botToken.trim() || undefined,
      });
      setBotMode(saved.mode);
      setBotUrl(saved.serverUrl);
      setBotToken("");
      setBotTokenSet(saved.tokenSet);
      setBotNote(saved.mode === "server" ? `${brand.displayName} is using the server bot. The local bot is stopped.` : `${brand.displayName} is running the bot on this computer again.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the bot connection.");
    } finally {
      setBusy(false);
    }
  }

  function patchFeed(patch: Partial<FeedToggles>): void {
    setFeed((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function setEmote(key: keyof FeedToggles["emotes"], checked: boolean): void {
    setFeed((current) => ({ ...current, emotes: { ...current.emotes, [key]: checked } }));
    setSaved(false);
  }

  function setNotice(key: NoticeKind, checked: boolean): void {
    setFeed((current) => ({ ...current, notices: { ...current.notices, [key]: checked } }));
    setSaved(false);
  }

  const twitchOn = isPlatformEnabled(settings.platforms, "twitch");
  const youtubeOn = isPlatformEnabled(settings.platforms, "youtube");
  const kickOn = isPlatformEnabled(settings.platforms, "kick");

  useEffect(() => {
    if (!kickOn || !window.rascal) return;
    void window.rascal.kickDeskState().then(setKickDesk).catch(() => setKickDesk(null));
  }, [kickOn, settings.kickRelayUrl]);

  async function changePlatform(id: string, on: boolean): Promise<void> {
    setError(null);
    setSaved(false);
    try {
      const result = requestPlatformToggle(settings.platforms, id, on);
      if (result.confirmKick) {
        setKickNotice(true);
        return;
      }
      await onSave({ platforms: result.next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Choose at least one platform.");
    }
  }

  async function changeTab(id: string, shown: boolean): Promise<void> {
    setError(null);
    setSaved(false);
    try {
      await onSave({ tabs: setTabShown(settings.tabs, id, shown) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that tab.");
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    const overlayPort = Number(port);
    try {
      await onSave({
        twitchClientId: clientId.trim(),
        twitchChannel: channel.trim(),
        youtubeChannelId: youtube.trim(),
        kickRelayUrl: kickUrl.trim(),
        overlayPort,
        autoImportFirebot: autoImport,
        feed,
        chatAlert: alert,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings" data-testid="settings">
      <div className="settings-inner">
        <header>
          <h2>Settings</h2>
          <p>{brand.displayName} {version}. Tokens stay in the config folder for this account and are never shown here.</p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h3>Platforms</h3>
          <p className="count">
            Choose the platforms you stream on. At least one stays on. Turning one off hides it and stops its connection. Logins and settings stay saved.
          </p>
          <PlatformPicker selection={settings.platforms} onToggle={(id, on) => void changePlatform(id, on)} />

          <h3>Tabs</h3>
          <p className="count">{TABS_SUMMARY}</p>
          <p className="count">{tabsPlatformSummary()}</p>
          <TabPicker tabs={settings.tabs} platforms={settings.platforms} onToggle={(id, shown) => void changeTab(id, shown)} />

          {twitchOn ? (
          <>
          <label>
            Twitch client ID
            <input
              data-testid="settings-client-id"
              value={clientId}
              spellCheck={false}
              autoCapitalize="off"
              placeholder="From the Twitch developer console"
              onChange={(event) => {
                setClientId(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label>
            Twitch chat channel
            <input
              value={channel}
              spellCheck={false}
              placeholder="Leave blank to use the signed-in channel"
              onChange={(event) => setChannel(event.target.value)}
            />
          </label>
          </>
          ) : null}
          {youtubeOn ? (
          <label>
            YouTube channel ID
            <input
              value={youtube}
              spellCheck={false}
              placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
              onChange={(event) => setYoutube(event.target.value)}
            />
            <span className="count">
              Leave blank to skip YouTube chat. The ID is in YouTube Studio. This reads chat with no Google login. Sending from the chat box needs a Google client on the Bot tab (youtube.force-ssl).
            </span>
          </label>
          ) : null}
          {kickOn ? (
            <div className="kick-settings" data-testid="kick-settings">
              <p className="count" data-testid="kick-relay-status">
                {kickRelayStatus({
                  relayUrl: settings.kickRelayUrl,
                  secretSet: kickDesk?.relaySecretSet === true,
                  detail: status.kick.detail,
                })}
              </p>
              <p className="count">
                Chat and events need a relay. Rascal hosting is not available yet.{" "}
                <a
                  href={KICK_RELAY_DOCS_URL}
                  onClick={(event) => {
                    event.preventDefault();
                    void window.rascal?.openExternal(KICK_RELAY_DOCS_URL);
                  }}
                >
                  Self-hosting instructions
                </a>
              </p>
              <label>
                Relay address
                <input
                  value={kickUrl}
                  spellCheck={false}
                  placeholder="wss://relay.example.com/v1/events"
                  onChange={(event) => {
                    setKickUrl(event.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              <label>
                Relay secret
                <input
                  type="password"
                  value={kickSecret}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={kickDesk?.relaySecretSet ? "Saved. Leave blank to keep it." : "At least 16 characters"}
                  onChange={(event) => setKickSecret(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => {
                  void window.rascal?.kickSaveRelay({ secret: kickSecret }).then((next) => {
                    setKickDesk(next);
                    setKickSecret("");
                  }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save the relay secret."));
                }}
              >
                Save relay secret
              </button>
              <label>
                Kick client ID
                <input
                  value={kickClientId || kickDesk?.clientId || ""}
                  spellCheck={false}
                  placeholder="From your Kick developer app"
                  onChange={(event) => setKickClientId(event.target.value)}
                />
              </label>
              <label>
                Kick client secret
                <input
                  type="password"
                  value={kickClientSecret}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={kickDesk?.clientSecretSet ? "Saved. Leave blank to keep it." : "From your Kick developer app"}
                  onChange={(event) => setKickClientSecret(event.target.value)}
                />
              </label>
              <div className="tts-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    void window.rascal?.kickSaveClient({ clientId: kickClientId || kickDesk?.clientId || "", clientSecret: kickClientSecret }).then((next) => {
                      setKickDesk(next);
                      setKickClientId(next.clientId);
                      setKickClientSecret("");
                    }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save the Kick app."));
                  }}
                >
                  Save Kick app
                </button>
                {kickDesk?.loggedIn ? (
                  <button type="button" className="ghost" disabled={busy} onClick={() => void window.rascal?.kickLogout().then(setKickDesk)}>
                    Log out of Kick
                  </button>
                ) : (
                  <button type="button" className="primary" disabled={busy} onClick={() => void window.rascal?.kickConnect().then(setKickDesk).catch((err: unknown) => setError(err instanceof Error ? err.message : "Kick login failed."))}>
                    Log in with Kick
                  </button>
                )}
              </div>
              <p className="count">
                {kickDesk?.loggedIn ? `Signed in as ${kickDesk.account || "your Kick account"}.` : "Not signed in."} Kick posts as this account. A separate bot account, channel-point redeems, follow age, and shoutouts are not available on Kick.
              </p>
              {kickDesk?.loggedIn && !kickDesk.scopes.includes("channel:write") ? (
                <p className="form-error">{KICK_TITLE_RELOGIN}</p>
              ) : null}
            </div>
          ) : null}
          <label>
            Overlay port
            <input
              value={port}
              inputMode="numeric"
              onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ""))}
            />
            <span className="count">
              {status.overlay.listening
                ? `Listening on ${status.overlay.host}:${status.overlay.port}`
                : "Overlay server is not listening"}
            </span>
          </label>
          {twitchOn ? (
            <CheckRow checked={autoImport} onChange={setAutoImport}>
              Import Firebot reward files on startup
            </CheckRow>
          ) : null}

          <h3>Message sound</h3>
          <p className="count">
            A short chime for new viewer messages. It stays off until you turn it on, and it still plays while this window is in the background. Your own messages, the bot, notices, and chat history do not play it.
          </p>
          <CheckRow checked={alert.enabled} onChange={(checked) => { setSaved(false); setAlert((current) => ({ ...current, enabled: checked })); }}>
            Play a sound for new messages
          </CheckRow>
          <CheckRow checked={alert.notices} onChange={(checked) => { setSaved(false); setAlert((current) => ({ ...current, notices: checked })); }}>
            Also play for notices
          </CheckRow>
          <label>
            Volume
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(alert.volume * 100)}
              onChange={(event) => setAlert((current) => ({ ...current, volume: Number(event.target.value) / 100 }))}
            />
            <span className="count">{Math.round(alert.volume * 100)}%</span>
          </label>
          <label>
            Cooldown (seconds)
            <input
              inputMode="decimal"
              value={String(alert.cooldownMs / 1000)}
              onChange={(event) => {
                const seconds = Number(event.target.value);
                if (!Number.isFinite(seconds)) return;
                setAlert((current) => ({ ...current, cooldownMs: Math.round(seconds * 1000) }));
              }}
            />
          </label>
          <p className="count">{alert.soundPath ? `Custom sound: ${alert.soundPath}` : "Using the built-in chime."}</p>
          <div className="form-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void playChatChime({
                  volume: alert.volume,
                  soundPath: alert.soundPath,
                  readFile: (filePath) => window.rascal?.readChatSound(filePath) ?? Promise.resolve(null),
                });
              }}
            >
              Test sound
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void window.rascal?.pickChatSound().then((file) => {
                  if (file) setAlert((current) => ({ ...current, soundPath: file }));
                }).catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : "That sound could not be used.");
                });
              }}
            >
              Choose sound
            </button>
            {alert.soundPath ? (
              <button type="button" className="ghost" onClick={() => setAlert((current) => ({ ...current, soundPath: "" }))}>
                Use built-in chime
              </button>
            ) : null}
          </div>

          <h3>Emotes</h3>
          <p className="count">Twitch and YouTube emotes in the message itself always render. These switches cover the extra catalogs. They start on.</p>
          <CheckRow checked={feed.emotes.bttv} onChange={(checked) => setEmote("bttv", checked)}>BetterTTV global and channel emotes</CheckRow>
          <CheckRow checked={feed.emotes.ffz} onChange={(checked) => setEmote("ffz", checked)}>FrankerFaceZ global and channel emotes</CheckRow>
          <CheckRow checked={feed.emotes.seventv} onChange={(checked) => setEmote("seventv", checked)}>7TV global and channel emotes</CheckRow>

          <h3>Notices</h3>
          <p className="count">Each kind can be hidden. Turning one off removes it from this chat view. The private mod log is never posted to chat or drawn on an overlay.</p>
          <div className="toggle-grid">
            {NOTICE_LABELS.map((item) => (
              <CheckRow key={item.key} checked={feed.notices[item.key]} onChange={(checked) => setNotice(item.key, checked)}>
                {item.label}
              </CheckRow>
            ))}
          </div>
          <CheckRow checked={feed.modLog} onChange={(checked) => patchFeed({ modLog: checked })}>
            Private mod log
          </CheckRow>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Saving" : "Save settings"}
            </button>
            {saved && <span className="saved">Saved</span>}
          </div>
        </form>

        {twitchOn ? (
        <section className="account">
          <h3>Twitch account</h3>
          {auth.loggedIn ? (
            <>
              <p>
                Logged in as <strong>{auth.login}</strong>
              </p>
              {auth.missingScopes.length > 0 && (
                <p className="form-error">Missing scopes: {auth.missingScopes.join(", ")}. Log in again to grant them.</p>
              )}
              <button type="button" className="ghost" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <p>Login uses the device code flow. {brand.displayName} never asks for a client secret.</p>
              <button type="button" className="primary" onClick={onLogin} disabled={!clientId.trim()}>
                Log in with Twitch
              </button>
            </>
          )}
        </section>
        ) : null}

        <section>
          <h3>Bot connection</h3>
          <p>Embedded mode runs the bot on this computer. Server mode controls one bot on a server you run and does not start a second copy. The address must be https, except for localhost.</p>
          <label>
            Mode
            <select value={botMode} onChange={(event) => setBotMode(event.target.value === "server" ? "server" : "embedded")}>
              <option value="embedded">Embedded on this computer</option>
              <option value="server">Server you run</option>
            </select>
          </label>
          <label>
            Server URL
            <input value={botUrl} onChange={(event) => setBotUrl(event.target.value)} placeholder="https://bot.example.com" spellCheck={false} />
          </label>
          <label>
            Admin token
            <input type="password" value={botToken} autoComplete="off" onChange={(event) => setBotToken(event.target.value)} placeholder={botTokenSet ? "A token is saved. Type a new one to replace it." : `Same value as ${brand.envPrefix}_BOT_API_KEY`} />
          </label>
          <button type="button" className="primary" disabled={busy} onClick={() => void saveBotConnection()}>
            Save bot connection
          </button>
          {botNote ? <p className="saved">{botNote}</p> : null}
        </section>

        {twitchOn ? (
        <>
        <section className="register">
          <h3>Register the Twitch app</h3>
          <p>Do this once, as the channel account, at the Twitch developer console. Create a new app. Do not reuse a Firebot client.</p>
          <ol>
            <li>Name: {brand.displayName} (optional if this app is already registered; the client ID stays the same)</li>
            <li>OAuth Redirect URLs: <code>http://localhost</code></li>
            <li>Category: Application Integration</li>
            <li>Client type: Public</li>
            <li>Create, then copy the Client ID into the field above</li>
          </ol>
          <button type="button" className="ghost" onClick={onOpenConsole}>
            Open Twitch developer console
          </button>
          <p className="count">
            The redirect URL is required by the console even though the device code is not sent there. A public client has no secret, which is what a desktop app can safely store.
          </p>
        </section>

        <section>
          <h3>Permissions on the consent screen</h3>
          <ul className="scope-list">
            {SCOPE_REASONS.map(([scope, reason]) => (
              <li key={scope}>
                <code>{scope}</code>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          <p className="count">
            A login from before 0.8.0 is missing the moderator read scopes, user:read:chat, and moderator:read:followers. Log in again and approve the new prompt. Chat keeps working before you do. Twitch only lets an app manage rewards it created.
          </p>
        </section>
        </>
        ) : null}
      </div>
      {kickNotice ? (
        <KickRelayDialog
          confirmLabel="Enable"
          onCancel={() => setKickNotice(false)}
          onConfirm={() => {
            setKickNotice(false);
            void onSave({ platforms: enableKick(settings.platforms) }).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Could not turn Kick on.");
            });
          }}
          onOpenDocs={(url) => void window.rascal?.openExternal(url)}
        />
      ) : null}
    </section>
  );
}
