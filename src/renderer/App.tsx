import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatOverlayFile } from "../shared/chat-overlay";
import { defaultChatOverlayFile } from "../shared/chat-overlay";
import type { RedeemSnapshot } from "../shared/redeems";
import type { KickDeskState } from "../shared/kick/desk-state";
import type { YoutubeDeskState } from "../shared/youtube/desk-state";
import type { AppEvent, AuthState, ChatMessage, ConnectionStatus, LoginPrompt, ModAction, Settings, StreamInfo } from "../shared/types";
import { ChatFeed } from "./components/ChatFeed";
import { ModLogPanel } from "./components/ModLogPanel";
import { ChatOverlayView } from "./components/ChatOverlayView";
import { Composer } from "./components/Composer";
import { LoginDialog } from "./components/LoginDialog";
import { RedeemsView } from "./components/RedeemsView";
import { SettingsView } from "./components/SettingsView";
import { StreamInfoView } from "./components/StreamInfoView";
import { TtsView } from "./components/TtsView";
import { BotView } from "./components/BotView";
import { brand } from "../shared/brand";
import { moderationOffer, youtubeModLogConnected } from "../shared/moderation";
import { resolveDeskView, setTabShown, type DeskView, type TabSettings } from "../shared/desk-tabs";
import { confirmPlatformSelection, isPlatformEnabled, platformsNeedingLogin, type PlatformSelection } from "../shared/platform/selection";
import { twitchLoginMissesReadScopes } from "../shared/scopes";
import { kickLink, twitchLink, youtubeLink, type SendTargets } from "../shared/send-targets";
import { defaultChatAlert } from "../shared/chat-alert";
import { playChatChime } from "./chat-sound";
import { RascalMark, GearIcon, PinIcon } from "./components/icons";
import { StatusPill } from "./components/StatusPill";
import { YoutubeStudioButton } from "./components/YoutubeStudioButton";
import { DeskTabs } from "./components/DeskTabs";
import { FirstRunPlatforms } from "./components/PlatformPicker";

export function App() {
  const [ready, setReady] = useState(false);
  const [bridgeError, setBridgeError] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [login, setLogin] = useState<LoginPrompt | null>(null);
  const [view, setView] = useState<DeskView>("desk");
  const [redeems, setRedeems] = useState<RedeemSnapshot | null>(null);
  const [chatOverlay, setChatOverlay] = useState<ChatOverlayFile>(defaultChatOverlayFile());
  const [toast, setToast] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [version, setVersion] = useState("0.11.0");
  const [modLog, setModLog] = useState<ModAction[]>([]);
  const [modOpen, setModOpen] = useState(false);
  const sendSeq = useRef(0);
  const tabSeq = useRef(0);
  const alertRef = useRef(defaultChatAlert());
  alertRef.current = settings?.chatAlert ?? alertRef.current;
  const [banner, setBanner] = useState(true);
  const [youtubeDesk, setYoutubeDesk] = useState<YoutubeDeskState | null>(null);
  const [kickDesk, setKickDesk] = useState<KickDeskState | null>(null);
  const [kickPreview, setKickPreview] = useState<{ title: string; categoryId: string; categoryName: string; live: boolean } | null>(null);
  const platformKey = settings?.platforms.enabled.join(",") ?? "";
  const youtubeAccountId = status?.youtube.accountChannelId ?? "";

  useEffect(() => {
    if (!window.rascal) {
      setBridgeError(true);
      return;
    }
    const bridge = window.rascal;
    let seq = 0;
    let live = false;
    const queued: AppEvent[] = [];
    const apply = (event: AppEvent) => {
      if (event.type === "chat") setMessages((current) => [...current, event.message].slice(-500));
      else if (event.type === "chat-replace") {
        setMessages((current) => current.map((message) => (message.id === event.message.id ? event.message : message)));
      } else if (event.type === "chat-alert") {
        const alert = alertRef.current;
        void playChatChime({
          volume: alert.volume,
          soundPath: alert.soundPath,
          readFile: (filePath) => window.rascal?.readChatSound(filePath) ?? Promise.resolve(null),
        });
      }
      else if (event.type === "mod-log") setModLog((current) => [...current, event.action].slice(-300));
      else if (event.type === "mod-log-clear") setModLog([]);
      else if (event.type === "chat-delete") {
        setMessages((current) => current.map((message) => (message.id === event.id ? { ...message, deleted: true } : message)));
      } else if (event.type === "chat-clear") {
        setMessages((current) =>
          current.map((message) => {
            if (message.platform !== event.platform) return message;
            if (event.username && message.username.toLowerCase() !== event.username.toLowerCase()) return message;
            return { ...message, deleted: true };
          }),
        );
      } else if (event.type === "status") setStatus(event.status);
      else if (event.type === "auth") setAuth(event.auth);
      else if (event.type === "login") setLogin(event.login);
      else if (event.type === "stream") setStream(event.stream);
      else if (event.type === "redeems") setRedeems(event.redeems);
      else if (event.type === "toast") setToast({ tone: event.tone, text: event.text });
    };
    const unsubscribe = bridge.onEvent((event) => {
      if (!live) queued.push(event);
      else if (event.seq > seq) {
        seq = event.seq;
        apply(event);
      }
    });
    void bridge
      .getSnapshot()
      .then((snap) => {
        seq = snap.seq;
        setMessages(snap.messages);
        setModLog(snap.modLog ?? []);
        setStatus(snap.status);
        setAuth(snap.auth);
        setSettings(snap.settings);
        setStream(snap.stream);
        setLogin(snap.login);
        setRedeems(snap.redeems);
        setChatOverlay(snap.chatOverlay);
        setVersion(snap.version);
        setReady(true);
        live = true;
        for (const event of queued) {
          if (event.seq > seq) {
            seq = event.seq;
            apply(event);
          }
        }
      })
      .catch(() => setBridgeError(true));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!settings) return;
    const next = resolveDeskView(view, settings.tabs, settings.platforms);
    if (next !== view) setView(next);
  }, [view, settings]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && view !== "desk" && !login) setView("desk");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, login]);

  const searchCategories = useCallback((query: string, platform?: "twitch" | "kick") => {
    if (!window.rascal) return Promise.reject(new Error(`${brand.displayName} is still starting.`));
    return window.rascal.searchCategories(query, platform);
  }, []);

  useEffect(() => {
    if (!ready || view !== "stream" || !window.rascal) return;
    const kickOnNow = platformKey.split(",").includes("kick");
    let cancel = false;
    const bridge = window.rascal;
    void bridge.youtubeDeskState().then((desk) => {
      if (!cancel) setYoutubeDesk(desk);
    }).catch(() => undefined);
    void bridge.kickDeskState().then((desk) => {
      if (!cancel) setKickDesk(desk);
    }).catch(() => undefined);
    if (kickOnNow) {
      void bridge.kickStream().then((row) => {
        if (!cancel) setKickPreview(row);
      }).catch(() => undefined);
    } else {
      setKickPreview(null);
    }
    return () => {
      cancel = true;
    };
  }, [ready, view, platformKey, youtubeAccountId]);

  async function saveTabs(next: TabSettings): Promise<void> {
    if (!settings) return;
    const seq = ++tabSeq.current;
    const previous = settings.tabs;
    setSettings((current) => (current ? { ...current, tabs: next } : current));
    try {
      const saved = await window.rascal!.updateSettings({ tabs: next });
      if (seq !== tabSeq.current) return;
      setSettings(saved);
    } catch (err) {
      if (seq !== tabSeq.current) return;
      setSettings((current) => (current ? { ...current, tabs: previous } : current));
      setToast({ tone: "error", text: err instanceof Error ? err.message : "Could not hide that tab." });
    }
  }

  async function saveSendTargets(next: SendTargets): Promise<void> {
    const seq = ++sendSeq.current;
    setSettings((current) => (current ? { ...current, sendTargets: next } : current));
    try {
      const saved = await window.rascal!.updateSettings({ sendTargets: next });
      if (seq !== sendSeq.current) return;
      setSettings(saved);
    } catch (err) {
      if (seq !== sendSeq.current) return;
      setToast({ tone: "error", text: err instanceof Error ? err.message : "Could not save where chat is sent." });
    }
  }

  async function promptPlatformLogins(previous: PlatformSelection, next: PlatformSelection, confirm: boolean, twitchClientId: string): Promise<void> {
    if (!window.rascal) return;
    const needs = platformsNeedingLogin({
      previous,
      next,
      confirm,
      twitchLoggedIn: auth?.loggedIn === true,
      youtubeLoggedIn: Boolean(status?.youtube.sendAccount),
    });
    if (needs.includes("twitch") && twitchClientId.trim()) void loginFlow();
    if (!needs.includes("youtube")) return;
    try {
      const desk = await window.rascal.youtubeDeskState();
      if (!desk.connected) await window.rascal.youtubeConnect();
    } catch (err) {
      const message = err instanceof Error ? err.message : "YouTube login did not start.";
      setToast({ tone: "error", text: message });
    }
  }

  async function loginFlow(): Promise<void> {
    if (!window.rascal) return;
    try {
      const next = await window.rascal.startLogin();
      setAuth(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed.";
      if (!/cancelled/i.test(message)) setToast({ tone: "error", text: message });
    }
  }

  if (bridgeError) {
    return (
      <main className="boot">
        <h1>{brand.displayName} could not open its window bridge.</h1>
        <p>Quit and start {brand.displayName} again. If it keeps happening, check the log in the config folder.</p>
      </main>
    );
  }

  if (!ready || !status || !auth || !settings) {
    return (
      <main className="boot">
        <RascalMark className="boot-mark" />
        <p>Starting {brand.displayName}…</p>
      </main>
    );
  }

  const shownView = resolveDeskView(view, settings.tabs, settings.platforms);
  const twitchOn = isPlatformEnabled(settings.platforms, "twitch");
  const youtubeOn = isPlatformEnabled(settings.platforms, "youtube");
  const kickOn = isPlatformEnabled(settings.platforms, "kick");
  const shownChannel = twitchOn ? settings.twitchChannel || auth.login || "" : "";
  const channelLabel = shownChannel ? `#${shownChannel}` : youtubeOn && settings.youtubeChannelId ? "YouTube" : "No channel";
  const youtubeTitle = status.youtube.title ? ` · ${status.youtube.title}` : "";
  const enabledIds = settings.platforms.enabled;

  if (!settings.platforms.confirmed) {
    return (
      <FirstRunPlatforms
        initial={settings.platforms}
        busy={false}
        error={toast?.tone === "error" ? toast.text : null}
        onContinue={(draft) => {
          const next = confirmPlatformSelection(draft);
          void window.rascal!.updateSettings({ platforms: next }).then((saved) => {
            setSettings(saved);
            void promptPlatformLogins(settings.platforms, saved.platforms, true, saved.twitchClientId);
          }).catch((err: unknown) => {
            setToast({ tone: "error", text: err instanceof Error ? err.message : "Could not save that choice." });
          });
        }}
      />
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <RascalMark />
          <div className="brand-copy">
            <strong>{brand.displayName}</strong>
            <span title={channelLabel}>{channelLabel}</span>
          </div>
        </div>
        <div className="pills">
          {twitchOn ? <StatusPill label="Twitch" state={status.twitch.state} detail={status.twitch.detail} viewers={status.twitch.viewers} /> : null}
          {youtubeOn ? (
            <div className="youtube-status">
              <StatusPill label="YouTube" state={status.youtube.state} detail={`${status.youtube.detail}${youtubeTitle}`} viewers={status.youtube.viewers} />
              <YoutubeStudioButton
                enabled
                broadcastId={status.youtube.videoId}
                channelId={status.youtube.accountChannelId || settings.youtubeChannelId}
                onOpen={(url) => void window.rascal?.openExternal(url)}
              />
            </div>
          ) : null}
          {kickOn ? <StatusPill label="Kick" state={status.kick.state} detail={status.kick.detail} viewers={status.kick.viewers} /> : null}
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={settings.alwaysOnTop ? "icon-button on" : "icon-button"}
            aria-pressed={settings.alwaysOnTop}
            title={`Keep ${brand.displayName} above other windows`}
            onClick={() => {
              const next = !settings.alwaysOnTop;
              setSettings({ ...settings, alwaysOnTop: next });
              void window.rascal?.setAlwaysOnTop(next);
            }}
          >
            <PinIcon />
            <span className="sr">Always on top</span>
          </button>
          <DeskTabs
            view={shownView}
            tabs={settings.tabs}
            platforms={settings.platforms}
            onOpen={setView}
            onHide={(id) => void saveTabs(setTabShown(settings.tabs, id, false))}
          />
          <button
            type="button"
            className={shownView === "settings" ? "icon-button on" : "icon-button"}
            aria-pressed={shownView === "settings"}
            title="Settings"
            onClick={() => setView(shownView === "settings" ? "desk" : "settings")}
          >
            <GearIcon />
            <span className="sr">Settings</span>
          </button>
        </div>
      </header>

      {banner && twitchOn && !auth.clientIdSet && shownView === "desk" && (
        <div className="banner">
          <p>Add a Twitch client ID under Settings → Advanced to edit stream info and send chat. The combined feed works before you log in.</p>
          <button type="button" onClick={() => setBanner(false)}>
            Dismiss
          </button>
        </div>
      )}

      {shownView === "chat" ? (
        <ChatOverlayView
          file={chatOverlay}
          messages={messages}
          enabledIds={enabledIds}
          overlayUrl={`http://${status.overlay.host}:${status.overlay.port}/overlay/chat`}
          onFile={setChatOverlay}
        />
      ) : shownView === "tts" ? (
        <TtsView enabledIds={enabledIds} />
      ) : shownView === "bot" ? (
        <BotView enabledIds={enabledIds} />
      ) : shownView === "stream" ? (
        <StreamInfoView
          auth={auth}
          stream={stream}
          chatChannel={shownChannel}
          enabledIds={enabledIds}
          youtube={{
            loggedIn: youtubeDesk?.connected === true,
            scopes: youtubeDesk?.scopes ?? [],
            title: status.youtube.title ?? "",
            videoId: status.youtube.videoId,
            channelId: status.youtube.accountChannelId || youtubeDesk?.channelId || settings.youtubeChannelId,
          }}
          kick={{
            loggedIn: kickDesk?.loggedIn === true,
            scopes: kickDesk?.scopes ?? [],
            title: kickPreview?.title ?? "",
            categoryId: kickPreview?.categoryId ?? "",
            categoryName: kickPreview?.categoryName ?? "",
          }}
          onSearch={searchCategories}
          onSave={async (request) => {
            const result = await window.rascal!.updateStreams(request);
            if (result.stream) setStream(result.stream);
            if (result.results.some((row) => row.platform === "kick" && row.ok)) {
              setKickPreview(await window.rascal!.kickStream());
            }
            return result;
          }}
          onLogin={() => void loginFlow()}
          onOpenSettings={() => setView("settings")}
          onOpenExternal={(url) => void window.rascal?.openExternal(url)}
          onYoutubeLogin={async () => {
            const desk = await window.rascal!.youtubeConnect();
            setYoutubeDesk(desk);
            if (desk.login?.verificationUri) await window.rascal!.openExternal(desk.login.verificationUri);
          }}
          onKickLogin={async () => {
            const desk = await window.rascal!.kickConnect();
            setKickDesk(desk);
            setKickPreview(await window.rascal!.kickStream());
          }}
        />
      ) : shownView === "redeems" && redeems ? (
        <RedeemsView state={redeems} onLogin={() => void loginFlow()} />
      ) : shownView === "settings" ? (
        <SettingsView
          settings={settings}
          auth={auth}
          status={status}
          version={version}
          onSave={async (patch) => {
            const previous = settings.platforms;
            const next = await window.rascal!.updateSettings(patch);
            setSettings(next);
            if (patch.platforms) void promptPlatformLogins(previous, next.platforms, false, next.twitchClientId);
          }}
          onLogin={() => void loginFlow()}
          onLogout={() => {
            void window.rascal?.logout().then(setAuth);
          }}
          onOpenConsole={() => void window.rascal?.openExternal("https://dev.twitch.tv/console/apps")}
        />
      ) : (
        <div className="workspace">
          <section className={modOpen ? "chat-column with-mod" : "chat-column"}>
            <ChatFeed
              messages={messages}
              enabledIds={enabledIds}
              offerFor={(message) =>
                moderationOffer(message, {
                  twitch: {
                    loggedIn: auth.loggedIn,
                    scopes: auth.scopes,
                    login: auth.login,
                    userId: auth.userId,
                    channelLogin: shownChannel,
                    broadcasterId: auth.login && shownChannel && auth.login.toLowerCase() === shownChannel.toLowerCase() ? auth.userId : null,
                  },
                  youtube: {
                    canModerate: status.youtube.canSend === true,
                    live: status.youtube.state === "live" || Boolean(status.youtube.videoId),
                    channelId: settings.youtubeChannelId.trim(),
                    accountChannelId: status.youtube.accountChannelId ?? null,
                  },
                })
              }
              onModerate={async (message, command) => {
                await window.rascal!.moderate({ ...command, messageId: message.id });
              }}
            />
            {modOpen ? (
              <ModLogPanel
                actions={modLog}
                enabled={settings.feed.modLog}
                enabledIds={enabledIds}
                twitchMissingReadScopes={twitchOn && twitchLoginMissesReadScopes(auth)}
                youtubeConnected={youtubeOn && youtubeModLogConnected(status.youtube.state)}
              />
            ) : null}
            <div className="mod-toggle">
              <button type="button" className={modOpen ? "text-button on" : "text-button"} onClick={() => setModOpen((open) => !open)}>
                {modOpen ? "Hide mod log" : "Mod log"}
              </button>
              <span>Private to Rascal. Never posted to chat.</span>
            </div>
            <Composer
              channel={shownChannel}
              targets={settings.sendTargets}
              shown={{ twitch: twitchOn, youtube: youtubeOn, kick: kickOn }}
              onTargets={(next) => void saveSendTargets(next)}
              twitch={twitchLink(status.twitch, auth.loggedIn)}
              youtube={youtubeLink(status.youtube)}
              kick={kickLink(status.kick, Boolean(status.kick.account))}
              canSendYoutube={status.youtube.canSend === true}
              youtubeAccount={status.youtube.sendAccount ?? null}
              sendHint={status.youtube.sendHint}
              onOpenSettings={() => setView("settings")}
              onOpenBot={() => setView("bot")}
              onSend={(text, destinations) => window.rascal!.sendChat(text, destinations)}
              loadMentions={(query) => window.rascal!.mentions(query)}
            />
          </section>
        </div>
      )}

      {toast && <div className={`toast ${toast.tone}`}>{toast.text}</div>}
      {login && twitchOn && (
        <LoginDialog
          login={login}
          onOpen={() => void window.rascal?.openExternal(login.verificationUri)}
          onCancel={() => void window.rascal?.cancelLogin()}
        />
      )}
    </div>
  );
}

