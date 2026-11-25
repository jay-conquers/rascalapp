import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BotSnapshot } from "../../shared/api";
import { checksFromTarget, targetFromChecks, type PlatformTarget } from "../../shared/platform/target";
import { CheckRow } from "./CheckRow";

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

export function TimerEditor({
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

export function PlatformCard({
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

export function PlatformChecks({
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

export function QuotaMeter({ quota }: { quota: { usedUnits: number; dailyLimit: number; state: string; detail: string } | null }) {
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

export function platformLabel(target: PlatformTarget | undefined): string {
  if (target === "all") return "Twitch and YouTube";
  if (target === "youtube") return "YouTube";
  return "Twitch";
}