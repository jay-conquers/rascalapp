import { useEffect, useState } from "react";
import { brand } from "../../shared/brand";
import type { AuthState, ConnectionStatus, Settings } from "../../shared/types";

const SCOPE_REASONS = [
  ["chat:read", "Read chat while logged in"],
  ["chat:edit", "Send chat over IRC if needed"],
  ["user:write:chat", "Send chat from this desk"],
  ["channel:manage:broadcast", "Change title, category, and tags"],
  ["channel:read:redemptions", "Later: hear channel point redeems"],
  ["channel:manage:redemptions", "Later: create rewards this app owns"],
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
  onSave: (patch: Pick<Settings, "twitchClientId" | "twitchChannel" | "youtubeChannelId" | "overlayPort" | "autoImportFirebot">) => Promise<void>;
  onLogin: () => void;
  onLogout: () => void;
  onOpenConsole: () => void;
}) {
  const [clientId, setClientId] = useState(settings.twitchClientId);
  const [channel, setChannel] = useState(settings.twitchChannel);
  const [youtube, setYoutube] = useState(settings.youtubeChannelId);
  const [port, setPort] = useState(String(settings.overlayPort));
  const [autoImport, setAutoImport] = useState(settings.autoImportFirebot !== false);
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
        overlayPort,
        autoImportFirebot: autoImport,
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
          <p>{brand.displayName} {version}. Tokens stay in ~/.config/{brand.configDirName}/ and are never shown here.</p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
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
          <label>
            YouTube channel ID
            <input
              value={youtube}
              spellCheck={false}
              placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
              onChange={(event) => setYoutube(event.target.value)}
            />
            <span className="count">Leave blank to skip YouTube chat. The ID is in YouTube Studio.</span>
          </label>
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
          <label className="check">
            <input type="checkbox" checked={autoImport} onChange={(event) => setAutoImport(event.target.checked)} />
            Import Firebot reward files on startup
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Saving" : "Save settings"}
            </button>
            {saved && <span className="saved">Saved</span>}
          </div>
        </form>

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

        <section>
          <h3>Bot connection</h3>
          <p>Embedded mode runs the bot on this computer. Server mode controls one bot on Fly and does not start a second copy.</p>
          <label>
            Mode
            <select value={botMode} onChange={(event) => setBotMode(event.target.value === "server" ? "server" : "embedded")}>
              <option value="embedded">Embedded on this computer</option>
              <option value="server">Server on Fly</option>
            </select>
          </label>
          <label>
            Server URL
            <input value={botUrl} onChange={(event) => setBotUrl(event.target.value)} placeholder="https://your-app.fly.dev" spellCheck={false} />
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
            Channel point permissions are requested now so a later update can manage rewards without asking again. This version does not create rewards or listen for redeems. Twitch only lets an app manage rewards it created.
          </p>
        </section>
      </div>
    </section>
  );
}
