import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SettingsPatch } from "../../shared/api";
import { brand } from "../../shared/brand";
import { NOTICE_LABELS, type FeedToggles, type NoticeKind } from "../../shared/feed-toggles";
import { defaultChatAlert, type ChatAlertSettings } from "../../shared/chat-alert";
import { TABS_SUMMARY, setTabShown, tabsPlatformSummary } from "../../shared/desk-tabs";
import { isPlatformEnabled, enableKick, requestPlatformToggle } from "../../shared/platform/selection";
import { kickRelayStatus } from "../../shared/kick/protocol";
import { KICK_RELAY_DOCS_URL } from "../../shared/kick/docs";
import type { KickDeskState } from "../../shared/kick/desk-state";
import { KickRelayDialog } from "./KickRelayNotice";
import { playChatChime } from "../chat-sound";
import { SETTINGS_SECTIONS, TWITCH_SCOPE_REASONS, settingsFormDirty, settingsFormPatch, settingsSectionLabel, type SettingsFormDraft, type SettingsSectionId } from "../settings-form";
import { AlertOutputPicker } from "./AlertOutputPicker";
import { CheckRow } from "./CheckRow";
import { TabPicker } from "./DeskTabs";
import { PlatformPicker } from "./PlatformPicker";
import type { AuthState, ConnectionStatus, Settings } from "../../shared/types";

function blockEnter(event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>): void {
  if (event.key === "Enter") event.preventDefault();
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label htmlFor={id}>
      {label}
      {children}
      {hint ? <span className="count">{hint}</span> : null}
    </label>
  );
}

function SettingsSection({ id, children }: { id: SettingsSectionId; children: ReactNode }) {
  const headingId = `settings-${id}-title`;
  return (
    <section
      id={`settings-section-${id}`}
      className="settings-section"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid={`settings-section-${id}`}
    >
      <h3 id={headingId}>{settingsSectionLabel(id)}</h3>
      {children}
    </section>
  );
}

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
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("platforms");
  const rootRef = useRef<HTMLElement>(null);
  const draft: SettingsFormDraft = {
    twitchClientId: clientId,
    twitchChannel: channel,
    youtubeChannelId: youtube,
    kickRelayUrl: kickUrl,
    overlayPort: port,
    autoImportFirebot: autoImport,
    feed,
    chatAlert: alert,
  };
  const dirty = settingsFormDirty(settings, draft);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = (): void => {
      const rootTop = root.getBoundingClientRect().top;
      let current: SettingsSectionId = SETTINGS_SECTIONS[0].id;
      for (const section of SETTINGS_SECTIONS) {
        const node = document.getElementById(`settings-section-${section.id}`);
        if (!node) continue;
        if (node.getBoundingClientRect().top - rootTop <= 96) current = section.id;
      }
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    onScroll();
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

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
      const savedLink = await window.rascal!.saveBotLink({
        mode: botMode,
        serverUrl: botUrl,
        adminToken: botToken.trim() || undefined,
      });
      setBotMode(savedLink.mode);
      setBotUrl(savedLink.serverUrl);
      setBotToken("");
      setBotTokenSet(savedLink.tokenSet);
      setBotNote(
        savedLink.mode === "server"
          ? `${brand.displayName} is using the server bot. The local bot is stopped.`
          : `${brand.displayName} is running the bot on this computer again.`,
      );
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
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(settingsFormPatch(draft));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  function showSection(id: SettingsSectionId): void {
    setActiveSection(id);
    document.getElementById(`settings-section-${id}`)?.scrollIntoView({ block: "start" });
  }

  function onNavKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    const current = document.activeElement?.id.replace("settings-nav-", "") ?? "";
    const index = ids.indexOf(current as (typeof ids)[number]);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % ids.length;
    else if (event.key === "ArrowUp") next = (index - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    else return;
    event.preventDefault();
    const id = ids[next] ?? "platforms";
    setActiveSection(id);
    document.getElementById(`settings-nav-${id}`)?.focus();
    document.getElementById(`settings-section-${id}`)?.scrollIntoView({ block: "start" });
  }

  return (
    <section ref={rootRef} className="settings" data-testid="settings">
      <div className="settings-inner">
        <header>
          <h2>Settings</h2>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections" data-testid="settings-nav" onKeyDown={onNavKeyDown}>
            <ul>
              {SETTINGS_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    id={`settings-nav-${section.id}`}
                    href={`#settings-section-${section.id}`}
                    aria-current={activeSection === section.id ? "true" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      showSection(section.id);
                    }}
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="settings-save">
              <button
                type="submit"
                form="settings-form"
                className={dirty ? "settings-save-button is-dirty" : "settings-save-button"}
                disabled={!dirty || busy}
                data-testid="settings-save"
                data-dirty={dirty ? "true" : "false"}
              >
                {busy ? "Saving" : "Save settings"}
              </button>
              {saved && !dirty ? <p className="saved">Saved</p> : null}
              {error ? <p className="form-error">{error}</p> : null}
            </div>
          </nav>

          <form
            id="settings-form"
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <SettingsSection id="platforms">
              <p className="count">
                Choose the platforms you stream on. At least one stays on. Turning one off hides it and stops its connection. Logins and settings stay saved.
              </p>
              <div data-setting="platforms">
                <PlatformPicker selection={settings.platforms} onToggle={(id, on) => void changePlatform(id, on)} />
              </div>

              {twitchOn ? (
                <div className="settings-block">
                  <h4>Twitch</h4>
                  <Field id="settings-twitch-channel" label="Twitch chat channel">
                    <input
                      id="settings-twitch-channel"
                      data-setting="twitchChannel"
                      value={channel}
                      spellCheck={false}
                      placeholder="Leave blank to use the signed-in channel"
                      onChange={(event) => {
                        setChannel(event.target.value);
                        setSaved(false);
                      }}
                    />
                  </Field>
                  <div className="account">
                    <h4>Account</h4>
                    {auth.loggedIn ? (
                      <>
                        <p>
                          Logged in as <strong>{auth.login}</strong>
                        </p>
                        {auth.missingScopes.length > 0 && (
                          <p className="form-error">This login is missing a permission. Log out and log in again to grant it.</p>
                        )}
                        <button type="button" className="ghost" aria-label="Log out of Twitch" onClick={onLogout}>
                          Log out
                        </button>
                      </>
                    ) : (
                      <>
                        <p>Not signed in.</p>
                        {!clientId.trim() ? <p className="count">Add a Twitch client ID under Advanced before logging in.</p> : null}
                        <button type="button" className="primary" aria-label="Log in to Twitch" onClick={onLogin} disabled={!clientId.trim()}>
                          Log in
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {youtubeOn ? (
                <div className="settings-block">
                  <h4>YouTube</h4>
                  <Field
                    id="settings-youtube-channel"
                    label="YouTube channel ID"
                    hint="Leave blank to skip YouTube chat. Find your channel ID in YouTube Studio. Reading chat works without signing in; sending chat requires connecting Google on the Bot tab."
                  >
                    <input
                      id="settings-youtube-channel"
                      data-setting="youtubeChannelId"
                      value={youtube}
                      spellCheck={false}
                      placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
                      onChange={(event) => {
                        setYoutube(event.target.value);
                        setSaved(false);
                      }}
                    />
                  </Field>
                </div>
              ) : null}

              {kickOn ? (
                <div className="settings-block kick-settings" data-testid="kick-settings">
                  <h4>Kick</h4>
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
                  <Field id="settings-kick-relay-url" label="Relay address">
                    <input
                      id="settings-kick-relay-url"
                      data-setting="kickRelayUrl"
                      value={kickUrl}
                      spellCheck={false}
                      placeholder="wss://relay.example.com/v1/events"
                      onChange={(event) => {
                        setKickUrl(event.target.value);
                        setSaved(false);
                      }}
                    />
                  </Field>
                  <Field id="settings-kick-relay-secret" label="Relay secret">
                    <input
                      id="settings-kick-relay-secret"
                      data-setting="kickRelay.secret"
                      type="password"
                      value={kickSecret}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={kickDesk?.relaySecretSet ? "Saved. Leave blank to keep it." : "At least 16 characters"}
                      onKeyDown={blockEnter}
                      onChange={(event) => setKickSecret(event.target.value)}
                    />
                  </Field>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      void window.rascal
                        ?.kickSaveRelay({ secret: kickSecret })
                        .then((next) => {
                          setKickDesk(next);
                          setKickSecret("");
                        })
                        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save the relay secret."));
                    }}
                  >
                    Save relay secret
                  </button>
                  <p className="count">Kick app credentials are under Advanced.</p>
                  <div className="tts-actions">
                    {kickDesk?.loggedIn ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        aria-label="Log out of Kick"
                        onClick={() => void window.rascal?.kickLogout().then(setKickDesk)}
                      >
                        Log out
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        aria-label="Log in to Kick"
                        onClick={() =>
                          void window.rascal
                            ?.kickConnect()
                            .then(setKickDesk)
                            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Kick login failed."))
                        }
                      >
                        Log in
                      </button>
                    )}
                  </div>
                  <p className="count">
                    {kickDesk?.loggedIn ? `Signed in as ${kickDesk.account || "your Kick account"}.` : "Not signed in."} Kick posts as this account. A separate bot account, channel-point redeems, follow age, and shoutouts are not available on Kick.
                  </p>
                  {kickDesk?.loggedIn && !kickDesk.scopes.includes("channel:write") ? (
                    <p className="form-error">Log out and log in again to edit the Kick title and category. Chat keeps working.</p>
                  ) : null}
                </div>
              ) : null}
            </SettingsSection>

            <SettingsSection id="chat">
              <h4>Emotes</h4>
              <p className="count">Twitch and YouTube emotes in a message always show. These switches add the extra emote sets. They start on.</p>
              <CheckRow id="settings-emote-bttv" setting="feed.emotes.bttv" checked={feed.emotes.bttv} onChange={(checked) => setEmote("bttv", checked)}>
                BetterTTV global and channel emotes
              </CheckRow>
              <CheckRow id="settings-emote-ffz" setting="feed.emotes.ffz" checked={feed.emotes.ffz} onChange={(checked) => setEmote("ffz", checked)}>
                FrankerFaceZ global and channel emotes
              </CheckRow>
              <CheckRow id="settings-emote-seventv" setting="feed.emotes.seventv" checked={feed.emotes.seventv} onChange={(checked) => setEmote("seventv", checked)}>
                7TV global and channel emotes
              </CheckRow>

              <h4>Notices</h4>
              <p className="count">Each kind can be hidden. Turning one off removes it from this chat view.</p>
              <div className="toggle-grid">
                {NOTICE_LABELS.map((item) => (
                  <CheckRow
                    key={item.key}
                    id={`settings-notice-${item.key}`}
                    setting={`feed.notices.${item.key}`}
                    checked={feed.notices[item.key]}
                    onChange={(checked) => setNotice(item.key, checked)}
                  >
                    {item.label}
                  </CheckRow>
                ))}
              </div>

              <h4>Bot connection</h4>
              <p className="count">
                Embedded runs the bot on this computer. Server controls a bot you host and does not start a second copy. The address must be https. A server on this computer can use http://localhost.
              </p>
              <Field id="settings-bot-mode" label="Mode">
                <select
                  id="settings-bot-mode"
                  data-setting="botLink.mode"
                  value={botMode}
                  onKeyDown={blockEnter}
                  onChange={(event) => setBotMode(event.target.value === "server" ? "server" : "embedded")}
                >
                  <option value="embedded">Embedded on this computer</option>
                  <option value="server">Server you run</option>
                </select>
              </Field>
              <Field id="settings-bot-url" label="Server URL">
                <input
                  id="settings-bot-url"
                  data-setting="botLink.serverUrl"
                  value={botUrl}
                  onKeyDown={blockEnter}
                  onChange={(event) => setBotUrl(event.target.value)}
                  placeholder="https://bot.example.com"
                  spellCheck={false}
                />
              </Field>
              <Field id="settings-bot-token" label="Admin token">
                <input
                  id="settings-bot-token"
                  data-setting="botLink.adminToken"
                  type="password"
                  value={botToken}
                  autoComplete="off"
                  onKeyDown={blockEnter}
                  onChange={(event) => setBotToken(event.target.value)}
                  placeholder={botTokenSet ? "A token is saved. Type a new one to replace it." : "Admin token from the server you run"}
                  spellCheck={false}
                />
              </Field>
              <button type="button" className="primary" disabled={busy} onClick={() => void saveBotConnection()}>
                Save bot connection
              </button>
              {botNote ? <p className="saved">{botNote}</p> : null}
            </SettingsSection>

            <SettingsSection id="tabs">
              <p className="count">{TABS_SUMMARY}</p>
              <p className="count">{tabsPlatformSummary()}</p>
              <div data-setting="tabs">
                <TabPicker tabs={settings.tabs} platforms={settings.platforms} onToggle={(id, shown) => void changeTab(id, shown)} />
              </div>
            </SettingsSection>

            <SettingsSection id="alerts">
              <h4>Message sound</h4>
              <p className="count">
                A short chime for new viewer messages. It stays off until you turn it on, and it still plays while this window is in the background. Your own messages, the bot, notices, and chat history do not play it.
              </p>
              <CheckRow
                id="settings-alert-enabled"
                setting="chatAlert.enabled"
                checked={alert.enabled}
                onChange={(checked) => {
                  setSaved(false);
                  setAlert((current) => ({ ...current, enabled: checked }));
                }}
              >
                Play a sound for new messages
              </CheckRow>
              <CheckRow
                id="settings-alert-notices"
                setting="chatAlert.notices"
                checked={alert.notices}
                onChange={(checked) => {
                  setSaved(false);
                  setAlert((current) => ({ ...current, notices: checked }));
                }}
              >
                Also play for notices
              </CheckRow>
              <Field id="settings-alert-volume" label="Volume" hint={`${Math.round(alert.volume * 100)}%`}>
                <input
                  id="settings-alert-volume"
                  data-setting="chatAlert.volume"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(alert.volume * 100)}
                  onChange={(event) => {
                    setSaved(false);
                    setAlert((current) => ({ ...current, volume: Number(event.target.value) / 100 }));
                  }}
                />
              </Field>
              <Field id="settings-alert-cooldown" label="Cooldown (seconds)">
                <input
                  id="settings-alert-cooldown"
                  data-setting="chatAlert.cooldownMs"
                  inputMode="decimal"
                  value={String(alert.cooldownMs / 1000)}
                  onChange={(event) => {
                    const seconds = Number(event.target.value);
                    if (!Number.isFinite(seconds)) return;
                    setSaved(false);
                    setAlert((current) => ({ ...current, cooldownMs: Math.round(seconds * 1000) }));
                  }}
                />
              </Field>
              <AlertOutputPicker
                deviceId={alert.outputDeviceId}
                onDeviceId={(outputDeviceId) => {
                  setSaved(false);
                  setAlert((current) => ({ ...current, outputDeviceId }));
                }}
                onTest={(outputDeviceId) => {
                  void playChatChime({
                    volume: alert.volume,
                    soundPath: alert.soundPath,
                    outputDeviceId,
                    readFile: (filePath) => window.rascal?.readChatSound(filePath) ?? Promise.resolve(null),
                  });
                }}
              />
              <p className="count">{alert.soundPath ? "Custom sound selected." : "Using the built-in chime."}</p>
              <div className="form-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void window.rascal
                      ?.pickChatSound()
                      .then((file) => {
                        if (file) {
                          setSaved(false);
                          setAlert((current) => ({ ...current, soundPath: file }));
                        }
                      })
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : "That sound could not be used.");
                      });
                  }}
                >
                  Choose sound
                </button>
                {alert.soundPath ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setSaved(false);
                      setAlert((current) => ({ ...current, soundPath: "" }));
                    }}
                  >
                    Use built-in chime
                  </button>
                ) : null}
              </div>
            </SettingsSection>

            <SettingsSection id="moderation">
              <p className="count">Records timeouts, bans, deletes, and mode changes in this window. It is never posted to chat or drawn on an overlay.</p>
              <CheckRow id="settings-mod-log" setting="feed.modLog" checked={feed.modLog} onChange={(checked) => patchFeed({ modLog: checked })}>
                Private mod log
              </CheckRow>
            </SettingsSection>

            <SettingsSection id="app">
              <p>
                Version <span data-testid="settings-version">{version}</span>
              </p>
              {twitchOn ? (
                <CheckRow
                  id="settings-auto-import"
                  setting="autoImportFirebot"
                  checked={autoImport}
                  onChange={(checked) => {
                    setAutoImport(checked);
                    setSaved(false);
                  }}
                >
                  Import Firebot reward files on startup
                </CheckRow>
              ) : null}
            </SettingsSection>

            <SettingsSection id="advanced">
              <h4>This computer</h4>
              <p className="count">Tokens stay in the config folder for this account and are never shown here.</p>
              <p className="count">If you run the bot on a server, the admin token is the same value as {brand.envPrefix}_BOT_API_KEY.</p>

              {twitchOn ? (
                <div className="settings-block register">
                  <h4>Twitch app</h4>
                  <Field id="settings-client-id" label="Twitch client ID">
                    <input
                      id="settings-client-id"
                      data-testid="settings-client-id"
                      data-setting="twitchClientId"
                      value={clientId}
                      spellCheck={false}
                      autoCapitalize="off"
                      placeholder="From the Twitch developer console"
                      onChange={(event) => {
                        setClientId(event.target.value);
                        setSaved(false);
                      }}
                    />
                  </Field>
                  <h4>Register the Twitch app</h4>
                  <p>Do this once, as the channel account, at the Twitch developer console. Create a new app. Do not reuse a Firebot client.</p>
                  <ol>
                    <li>Name: {brand.displayName} (optional if this app is already registered; the client ID stays the same)</li>
                    <li>
                      OAuth Redirect URLs: <code>http://localhost</code>
                    </li>
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
                  <p className="count">Login uses the device code flow. {brand.displayName} never asks for a client secret.</p>
                  <h4>Permissions on the consent screen</h4>
                  <ul className="scope-list">
                    {TWITCH_SCOPE_REASONS.map(([scope, reason]) => (
                      <li key={scope}>
                        <code>{scope}</code>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="count">
                    A login from before 0.8.0 is missing the moderator read scopes, user:read:chat, and moderator:read:followers. Log in again and approve the new prompt. Chat keeps working before you do. Twitch only lets an app manage rewards it created.
                  </p>
                </div>
              ) : null}

              {kickOn ? (
                <div className="settings-block">
                  <h4>Kick app</h4>
                  <Field id="settings-kick-client-id" label="Kick client ID">
                    <input
                      id="settings-kick-client-id"
                      data-setting="kickClient.clientId"
                      value={kickClientId || kickDesk?.clientId || ""}
                      spellCheck={false}
                      placeholder="From your Kick developer app"
                      onKeyDown={blockEnter}
                      onChange={(event) => setKickClientId(event.target.value)}
                    />
                  </Field>
                  <Field id="settings-kick-client-secret" label="Kick client secret">
                    <input
                      id="settings-kick-client-secret"
                      data-setting="kickClient.clientSecret"
                      type="password"
                      value={kickClientSecret}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={kickDesk?.clientSecretSet ? "Saved. Leave blank to keep it." : "From your Kick developer app"}
                      onKeyDown={blockEnter}
                      onChange={(event) => setKickClientSecret(event.target.value)}
                    />
                  </Field>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      void window.rascal
                        ?.kickSaveClient({ clientId: kickClientId || kickDesk?.clientId || "", clientSecret: kickClientSecret })
                        .then((next) => {
                          setKickDesk(next);
                          setKickClientId(next.clientId);
                          setKickClientSecret("");
                        })
                        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save the Kick app."));
                    }}
                  >
                    Save Kick app
                  </button>
                </div>
              ) : null}

              <div className="settings-block">
                <h4>Overlay</h4>
                <Field
                  id="settings-overlay-port"
                  label="Overlay port"
                  hint={status.overlay.listening ? `Listening on ${status.overlay.host}:${status.overlay.port}` : "Overlay server is not listening"}
                >
                  <input
                    id="settings-overlay-port"
                    data-setting="overlayPort"
                    value={port}
                    inputMode="numeric"
                    onChange={(event) => {
                      setPort(event.target.value.replace(/[^\d]/g, ""));
                      setSaved(false);
                    }}
                  />
                </Field>
              </div>

              <div className="settings-block">
                <h4>Sound file</h4>
                <p className="count" data-setting="chatAlert.soundPath" data-testid="settings-sound-path">
                  {alert.soundPath ? `Custom sound file: ${alert.soundPath}` : "Using the built-in chime."}
                </p>
              </div>
            </SettingsSection>

            <div className="settings-savebar">
              <p className="count">
                Saves channels, the relay address, the overlay port, emotes, notices, the message sound and its output device, and Firebot import. Platforms, tabs, the relay secret, the Kick app, and the bot connection save with their own controls.
              </p>
            </div>
          </form>
        </div>
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
