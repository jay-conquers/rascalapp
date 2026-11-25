import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatOverlayFile } from "../shared/chat-overlay";
import { defaultChatOverlayFile } from "../shared/chat-overlay";
import type { RedeemSnapshot } from "../shared/redeems";
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
import { twitchLoginMissesReadScopes } from "../shared/scopes";
import { twitchLink, youtubeLink, type SendTargets } from "../shared/send-targets";
import { defaultChatAlert } from "../shared/chat-alert";
import { playChatChime } from "./chat-sound";
import { RascalMark, GearIcon, PinIcon } from "./components/icons";

export function App() {
  const [ready, setReady] = useState(false);
  const [bridgeError, setBridgeError] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [login, setLogin] = useState<LoginPrompt | null>(null);
  const [view, setView] = useState<"desk" | "settings" | "redeems" | "stream" | "chat" | "tts" | "bot">("desk");
  const [redeems, setRedeems] = useState<RedeemSnapshot | null>(null);
  const [chatOverlay, setChatOverlay] = useState<ChatOverlayFile>(defaultChatOverlayFile());
  const [toast, setToast] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [version, setVersion] = useState("0.9.0");
  const [modLog, setModLog] = useState<ModAction[]>([]);
  const [modOpen, setModOpen] = useState(false);
  const sendSeq = useRef(0);
  const alertRef = useRef(defaultChatAlert());
  alertRef.current = settings?.chatAlert ?? alertRef.current;
  const [banner, setBanner] = useState(true);

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

  const searchCategories = useCallback((query: string) => {
    if (!window.rascal) return Promise.reject(new Error(`${brand.displayName} is still starting.`));
    return window.rascal.searchCategories(query);
  }, []);

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

  const shownChannel = settings.twitchChannel || auth.login || "";
  const youtubeTitle = status.youtube.title ? ` · ${status.youtube.title}` : "";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <RascalMark />
          <div>
            <strong>{brand.displayName}</strong>
            <span>{shownChannel ? `#${shownChannel}` : "No channel"}</span>
          </div>
        </div>
        <div className="pills">
          <StatusPill label="Twitch" state={status.twitch.state} detail={status.twitch.detail} viewers={status.twitch.viewers} />
          <StatusPill label="YouTube" state={status.youtube.state} detail={`${status.youtube.detail}${youtubeTitle}`} viewers={status.youtube.viewers} />
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
          <button
            type="button"
            className={view === "redeems" ? "text-button on" : "text-button"}
            onClick={() => setView((current) => (current === "redeems" ? "desk" : "redeems"))}
          >
            Redeems
          </button>
          <button
            type="button"
            className={view === "stream" ? "text-button on" : "text-button"}
            onClick={() => setView((current) => (current === "stream" ? "desk" : "stream"))}
          >
            Stream info
          </button>
          <button
            type="button"
            className={view === "chat" ? "text-button on" : "text-button"}
            onClick={() => setView((current) => (current === "chat" ? "desk" : "chat"))}
          >
            Chat overlay
          </button>
          <button
            type="button"
            className={view === "tts" ? "text-button on" : "text-button"}
            onClick={() => setView((current) => (current === "tts" ? "desk" : "tts"))}
          >
            TTS
          </button>
          <button
            type="button"
            className={view === "bot" ? "text-button on" : "text-button"}
            onClick={() => setView((current) => (current === "bot" ? "desk" : "bot"))}
          >
            Bot
          </button>
          <button
            type="button"
            className={view === "settings" ? "icon-button on" : "icon-button"}
            aria-pressed={view === "settings"}
            title="Settings"
            onClick={() => setView((current) => (current === "settings" ? "desk" : "settings"))}
          >
            <GearIcon />
            <span className="sr">Settings</span>
          </button>
        </div>
      </header>

      {banner && !auth.clientIdSet && view === "desk" && (
        <div className="banner">
          <p>Add a Twitch client ID in Settings to edit stream info and send chat. The combined feed works before you log in.</p>
          <button type="button" onClick={() => setBanner(false)}>
            Dismiss
          </button>
        </div>
      )}

      {view === "chat" ? (
        <ChatOverlayView
          file={chatOverlay}
          messages={messages}
          overlayUrl={`http://${status.overlay.host}:${status.overlay.port}/overlay/chat`}
          onFile={setChatOverlay}
        />
      ) : view === "tts" ? (
        <TtsView />
      ) : view === "bot" ? (
        <BotView />
      ) : view === "stream" ? (
        <StreamInfoView
          auth={auth}
          stream={stream}
          chatChannel={shownChannel}
          onSearch={searchCategories}
          onSave={async (update) => {
            const next = await window.rascal!.updateStream(update);
            setStream(next);
          }}
          onLogin={() => void loginFlow()}
          onOpenSettings={() => setView("settings")}
        />
      ) : view === "redeems" && redeems ? (
        <RedeemsView state={redeems} onLogin={() => void loginFlow()} />
      ) : view === "settings" ? (
        <SettingsView
          settings={settings}
          auth={auth}
          status={status}
          version={version}
          onSave={async (patch) => {
            const next = await window.rascal!.updateSettings(patch);
            setSettings(next);
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
                twitchMissingReadScopes={twitchLoginMissesReadScopes(auth)}
                youtubeConnected={youtubeModLogConnected(status.youtube.state)}
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
              onTargets={(next) => void saveSendTargets(next)}
              twitch={twitchLink(status.twitch, auth.loggedIn)}
              youtube={youtubeLink(status.youtube)}
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
      {login && (
        <LoginDialog
          login={login}
          onOpen={() => void window.rascal?.openExternal(login.verificationUri)}
          onCancel={() => void window.rascal?.cancelLogin()}
        />
      )}
    </div>
  );
}

function StatusPill({ label, state, detail, viewers }: { label: string; state: string; detail: string; viewers?: number | null }) {
  const watching = typeof viewers === "number" ? `${viewers.toLocaleString("en-US")} watching` : "";
  return (
    <p className={`pill state-${state}`} title={watching ? `${detail} · ${watching}` : detail}>
      <i />
      <span>{label}</span>
      <em>{shortDetail(detail)}</em>
      {watching ? <strong className="viewers">{watching}</strong> : null}
    </p>
  );
}

function shortDetail(detail: string): string {
  const clean = detail.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 40)}…` : clean;
}
