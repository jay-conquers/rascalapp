import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CHAT_BOX_PRESETS,
  chatBoxRect,
  chatFlow,
  defaultPreset,
  hexToRgba,
  overlayTextShadow,
  projectChatOverlay,
  type ChatBox,
  type ChatBoxPreset,
  type ChatOverlayFile,
  type ChatOverlayStyle,
} from "../../shared/chat-overlay";
import type { ChatMessage } from "../../shared/types";
import { TwitchMark, YouTubeMark } from "./icons";

const SAMPLES: ChatMessage[] = [
  {
    id: "sample-ace",
    platform: "twitch",
    channel: "examplechannel",
    username: "ace",
    displayName: "Ace",
    color: "#bf94ff",
    badges: [
      {
        kind: "sub",
        label: "SUB",
        detail: "12",
        set: "subscriber",
        version: "12",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/2",
      },
    ],
    segments: [
      { type: "text", text: "this layout is " },
      { type: "emote", text: "Pog", url: "https://cdn.betterttv.net/emote/sample/2x", source: "bttv" },
    ],
    plainText: "this layout is Pog",
    timestamp: Date.now(),
    kind: "chat",
  },
  {
    id: "sample-owner",
    platform: "youtube",
    channel: "examplechannel",
    username: "owner",
    displayName: "Owner",
    color: "#ff8a4a",
    badges: [],
    segments: [{ type: "text", text: "YouTube owner, mod, and member badges show here too." }],
    plainText: "YouTube owner, mod, and member badges show here too.",
    timestamp: Date.now(),
    kind: "chat",
  },
  {
    id: "sample-bot",
    platform: "twitch",
    channel: "examplechannel",
    username: "nightbot",
    displayName: "Nightbot",
    color: "#ffffff",
    badges: [],
    segments: [{ type: "text", text: "this bot line should be hidden" }],
    plainText: "this bot line should be hidden",
    timestamp: Date.now(),
    kind: "chat",
  },
  {
    id: "sample-cmd",
    platform: "twitch",
    channel: "examplechannel",
    username: "viewer",
    displayName: "viewer",
    color: "#7dd3fc",
    badges: [],
    segments: [{ type: "text", text: "!play" }],
    plainText: "!play",
    timestamp: Date.now(),
    kind: "chat",
  },
];

export function ChatOverlayView({
  file,
  messages,
  overlayUrl,
  onFile,
}: {
  file: ChatOverlayFile;
  messages: ChatMessage[];
  overlayUrl: string;
  onFile: (file: ChatOverlayFile) => void;
}) {
  const initial = file.presets[0] ?? defaultPreset();
  const [selected, setSelected] = useState(initial.id);
  const [draft, setDraft] = useState<ChatOverlayStyle>(initial);
  const [usersText, setUsersText] = useState(initial.hiddenUsers.join("\n"));
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const draftRef = useRef(draft);
  const timer = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  draftRef.current = draft;

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const presetUrl = draft.id === "default" ? overlayUrl : `${overlayUrl}?preset=${encodeURIComponent(draft.id)}`;
  const rect = chatBoxRect(draft.box);
  const source = messages.length > 0 ? messages : SAMPLES.map((message) => ({ ...message, timestamp: Date.now() }));
  const lines = projectChatOverlay(source, draft);
  const flow = chatFlow(draft.direction);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = flow.scrollToEnd ? log.scrollHeight : 0;
  }, [flow.scrollToEnd, lines, rect.left, rect.top, rect.width, rect.height]);

  function edit(patch: Partial<ChatOverlayStyle>, users?: string) {
    const next = { ...draftRef.current, ...patch };
    setDraft(next);
    if (users !== undefined) setUsersText(users);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void persist(next);
    }, 200);
  }

  async function persist(next: ChatOverlayStyle): Promise<void> {
    if (!window.rascal) return;
    try {
      const saved = await window.rascal.saveChatPreset(next);
      const live = draftRef.current;
      onFile({
        ...saved,
        presets: saved.presets.map((item) => (item.id === live.id ? live : item)),
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the overlay.");
    }
  }

  function choose(id: string): void {
    const preset = file.presets.find((item) => item.id === id) ?? file.presets.find((item) => item.id === draft.id);
    if (!preset) return;
    if (timer.current) window.clearTimeout(timer.current);
    void persist(draftRef.current);
    setSelected(preset.id);
    setDraft(preset);
    setUsersText(preset.hiddenUsers.join("\n"));
  }

  async function addPreset(): Promise<void> {
    if (!window.rascal) return;
    try {
      const saved = await window.rascal.createChatPreset(newName, draft.id);
      onFile(saved);
      const created = saved.presets[saved.presets.length - 1];
      if (created) {
        setSelected(created.id);
        setDraft(created);
        setUsersText(created.hiddenUsers.join("\n"));
      }
      setNewName("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that preset.");
    }
  }

  async function removePreset(): Promise<void> {
    if (!window.rascal || draft.id === "default") return;
    try {
      const saved = await window.rascal.deleteChatPreset(draft.id);
      onFile(saved);
      const next = saved.presets[0];
      if (next) {
        setSelected(next.id);
        setDraft(next);
        setUsersText(next.hiddenUsers.join("\n"));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that preset.");
    }
  }

  return (
    <section className="overlay-page">
      <header className="redeem-bar">
        <div>
          <h2>Chat overlay</h2>
          <p>OBS browser source, transparent. Changes reach open sources over the socket.</p>
        </div>
        <div className="overlay-url">
          <code>{presetUrl}</code>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(presetUrl).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </header>

      <div className="overlay-layout">
        <form
          className="overlay-form"
          onSubmit={(event) => {
            event.preventDefault();
            void persist(draft);
          }}
        >
          <label>
            Preset
            <select value={selected} onChange={(event) => choose(event.target.value)}>
              {file.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.id})
                </option>
              ))}
            </select>
          </label>
          <div className="file-row">
            <input
              value={newName}
              placeholder="New preset name"
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="button" className="ghost" onClick={() => void addPreset()}>
              Add
            </button>
            <button type="button" className="ghost" disabled={draft.id === "default"} onClick={() => void removePreset()}>
              Delete
            </button>
          </div>
          <label>
            Name
            <input value={draft.name} onChange={(event) => edit({ name: event.target.value })} />
          </label>
          <label>
            Font family
            <input value={draft.fontFamily} onChange={(event) => edit({ fontFamily: event.target.value })} />
          </label>
          <label>
            Font size ({draft.fontSize}px)
            <input type="range" min={12} max={72} value={draft.fontSize} onChange={(event) => edit({ fontSize: Number(event.target.value) })} />
          </label>
          <div className="custom-offset">
            <label>
              Text
              <input type="color" value={draft.textColor} onChange={(event) => edit({ textColor: event.target.value })} />
            </label>
            <label>
              Name
              <input type="color" value={draft.nameColor} onChange={(event) => edit({ nameColor: event.target.value })} />
            </label>
            <label>
              Pill
              <input type="color" value={draft.backgroundColor} onChange={(event) => edit({ backgroundColor: event.target.value })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.useAuthorColor} onChange={(event) => edit({ useAuthorColor: event.target.checked })} />
            Use each chatter's own name color
          </label>
          <label>
            Background
            <select value={draft.background} onChange={(event) => edit({ background: event.target.value === "none" ? "none" : "pill" })}>
              <option value="none">None</option>
              <option value="pill">Per-message pill</option>
            </select>
          </label>
          <label>
            Pill opacity ({Math.round(draft.backgroundOpacity * 100)}%)
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(draft.backgroundOpacity * 100)}
              onChange={(event) => edit({ backgroundOpacity: Number(event.target.value) / 100 })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.outline} onChange={(event) => edit({ outline: event.target.checked })} />
            Text outline
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.shadow} onChange={(event) => edit({ shadow: event.target.checked })} />
            Text shadow
          </label>
          <div className="custom-offset">
            <label>
              Max messages
              <input type="number" min={1} max={40} value={draft.maxMessages} onChange={(event) => edit({ maxMessages: Number(event.target.value) })} />
            </label>
            <label>
              Lifetime (seconds, 0 stays)
              <input type="number" min={0} max={600} value={draft.lifetimeSeconds} onChange={(event) => edit({ lifetimeSeconds: Number(event.target.value) })} />
            </label>
          </div>
          <label>
            Message anchor
            <select
              value={draft.direction}
              onChange={(event) => {
                const value = event.target.value;
                edit({ direction: value === "top" || value === "down" ? value : "bottom" });
              }}
            >
              <option value="bottom">Bottom (newest at bottom)</option>
              <option value="down">Top (newest at bottom, fills downward)</option>
              <option value="top">Top (newest at top)</option>
            </select>
          </label>
          <ChatBoxControls box={draft.box} onChange={(box) => edit({ box })} />
          <label className="check">
            <input type="checkbox" checked={draft.showPlatformIcons} onChange={(event) => edit({ showPlatformIcons: event.target.checked })} />
            Platform icons
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.showBadges} onChange={(event) => edit({ showBadges: event.target.checked })} />
            Badges
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.hideCommands} onChange={(event) => edit({ hideCommands: event.target.checked })} />
            Hide messages starting with !
          </label>
          <label>
            Hidden users, one per line
            <textarea
              rows={6}
              value={usersText}
              onChange={(event) => {
                const text = event.target.value;
                edit(
                  { hiddenUsers: text.split(/\n+/).map((line) => line.trim()).filter(Boolean) },
                  text,
                );
              }}
            />
          </label>
          <p className="form-note">Bots such as Nightbot and Streamelements are hidden by default. Add the TTS bot's username if it posts into chat.</p>
          {error && <p className="form-error">{error}</p>}
        </form>

        <div className="overlay-preview-wrap">
          <p className="form-note">{messages.length > 0 ? "Live chat, with this preset's filters." : "Sample lines until chat arrives. Nightbot and !play are in the sample so you can see them drop out."}</p>
          <div className="overlay-preview" aria-label="Chat overlay preview">
            <div
              ref={logRef}
              className="overlay-log"
              style={{
                fontFamily: draft.fontFamily,
                fontSize: Math.min(draft.fontSize, 18),
                color: draft.textColor,
                left: `${(rect.left / 1920) * 100}%`,
                top: `${(rect.top / 1080) * 100}%`,
                width: `${(rect.width / 1920) * 100}%`,
                height: `${(rect.height / 1080) * 100}%`,
                textAlign: "left",
                justifyContent: flow.anchor === "end" ? "flex-end" : "flex-start",
                textShadow: overlayTextShadow(draft),
              }}
            >
              {lines.length === 0 ? <p className="overlay-empty">Nothing to show with these filters.</p> : null}
              {lines.map((line) => (
                <div
                  key={line.id}
                  className="overlay-row"
                  style={{
                    opacity: line.opacity,
                    justifyContent: "flex-start",
                    background: draft.background === "pill" ? hexToRgba(draft.backgroundColor, draft.backgroundOpacity) : "transparent",
                  }}
                >
                  {draft.showPlatformIcons ? (
                    <span className={`platform ${line.platform}`} title={line.platform === "twitch" ? "Twitch" : "YouTube"}>
                      {line.platform === "twitch" ? <TwitchMark /> : <YouTubeMark />}
                    </span>
                  ) : null}
                  <div>
                    {line.notice ? <span className="notice">{line.notice}</span> : null}
                    {line.name ? (
                      <span className="name" style={{ color: line.nameColor }}>
                        {line.name}
                      </span>
                    ) : null}
                    {line.badges.map((badge) => (
                      <img
                        key={`${line.id}-${badge.url}`}
                        className="badge"
                        alt=""
                        src={badge.url}
                        onError={(event) => event.currentTarget.remove()}
                      />
                    ))}
                    {line.amount ? <span className="amount">{line.amount}</span> : null}
                    <span className={line.action ? "action" : undefined}>
                      {line.parts.map((part, index) =>
                        part.type === "emote" && part.url ? (
                          <img
                            key={`${line.id}-${index}`}
                            className="emote"
                            alt={part.text}
                            src={part.url}
                            onError={(event) => {
                              event.currentTarget.replaceWith(document.createTextNode(part.text));
                            }}
                          />
                        ) : (
                          <span key={`${line.id}-${index}`}>{part.text}</span>
                        ),
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const BOX_LABELS: Record<ChatBoxPreset, string> = {
  "right-column": "Right column",
  "left-column": "Left column",
  "bottom-strip": "Bottom strip",
  full: "Full frame",
  custom: "Custom",
};

function ChatBoxControls({ box, onChange }: { box: ChatBox; onChange: (box: ChatBox) => void }) {
  const rect = chatBoxRect(box);
  return (
    <div className="placement">
      <label>
        Chat box
        <select
          value={box.preset}
          onChange={(event) => {
            const preset = event.target.value as ChatBoxPreset;
            if (preset === "custom") {
              onChange({
                ...box,
                preset,
                unit: "percent",
                x: Math.round((rect.left / 1920) * 1000) / 10,
                y: Math.round((rect.top / 1080) * 1000) / 10,
                width: Math.round((rect.width / 1920) * 1000) / 10,
                height: Math.round((rect.height / 1080) * 1000) / 10,
              });
              return;
            }
            onChange({ ...box, preset });
          }}
        >
          {CHAT_BOX_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {BOX_LABELS[preset]}
            </option>
          ))}
        </select>
      </label>
      {box.preset !== "custom" && box.preset !== "full" && (
        <label>
          Size {box.sizePercent}%
          <input
            type="range"
            min={5}
            max={100}
            value={box.sizePercent}
            onChange={(event) => onChange({ ...box, sizePercent: Number(event.target.value) })}
          />
        </label>
      )}
      {box.preset !== "custom" && (
        <label>
          Edge margin {box.marginPercent}%
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={box.marginPercent}
            onChange={(event) => onChange({ ...box, marginPercent: Number(event.target.value) })}
          />
        </label>
      )}
      {box.preset === "custom" && (
        <div className="custom-offset">
          <label>
            X
            <input value={String(box.x)} onChange={(event) => onChange({ ...box, x: Number(event.target.value) || 0 })} />
          </label>
          <label>
            Y
            <input value={String(box.y)} onChange={(event) => onChange({ ...box, y: Number(event.target.value) || 0 })} />
          </label>
          <label>
            Width
            <input value={String(box.width)} onChange={(event) => onChange({ ...box, width: Number(event.target.value) || 0 })} />
          </label>
          <label>
            Height
            <input value={String(box.height)} onChange={(event) => onChange({ ...box, height: Number(event.target.value) || 0 })} />
          </label>
          <label>
            Units
            <select value={box.unit} onChange={(event) => onChange({ ...box, unit: event.target.value === "px" ? "px" : "percent" })}>
              <option value="percent">Percent</option>
              <option value="px">Pixels</option>
            </select>
          </label>
        </div>
      )}
      <p className="count">
        {rect.left}×{rect.top}, {rect.width}×{rect.height} on 1920×1080. Messages stay left-aligned inside the box.
      </p>
    </div>
  );
}
