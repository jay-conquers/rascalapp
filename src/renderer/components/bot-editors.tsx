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
  kick: boolean;
}

function blankTimerDraft(enabledIds?: readonly string[]): TimerDraft {
  const showTwitch = !enabledIds || enabledIds.includes("twitch");
  const showYoutube = !enabledIds || enabledIds.includes("youtube");
  const showKick = Boolean(enabledIds?.includes("kick"));
  return {
    name: "",
    messagesText: "{title} is live",
    mode: "live",
    intervalSec: "600",
    minChatLines: "5",
    offlineIntervalSec: "1800",
    offlineMinChatLines: "5",
    enabled: true,
    twitch: showTwitch || (!showYoutube && !showKick),
    youtube: showYoutube && !showTwitch && !showKick,
    kick: showKick && !showTwitch && !showYoutube,
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
    kick: checks.kick,
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
  enabledIds,
}: {
  timer: SavedTimer | null;
  busy: boolean;
  onSave: (input: Record<string, unknown>) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  enabledIds?: readonly string[];
}) {
  const [draft, setDraft] = useState<TimerDraft>(() => (timer ? draftFromTimer(timer) : blankTimerDraft(enabledIds)));
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
        target={targetFromChecks(draft.twitch, draft.youtube, draft.kick)}
        disabled={busy}
        enabledIds={enabledIds}
        onChange={(platforms) => {
          const next = checksFromTarget(platforms);
          edit({ twitch: next.twitch, youtube: next.youtube, kick: next.kick });
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
              platforms: targetFromChecks(draft.twitch, draft.youtube, draft.kick),
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
  enabledIds,
}: {
  target: PlatformTarget | undefined;
  disabled: boolean;
  onChange: (target: PlatformTarget) => void;
  /** When set, hidden platforms keep the target they already had. */
  enabledIds?: readonly string[];
}) {
  const checks = checksFromTarget(target);
  const showTwitch = !enabledIds || enabledIds.includes("twitch");
  const showYoutube = !enabledIds || enabledIds.includes("youtube");
  const showKick = !enabledIds || enabledIds.includes("kick");
  function commit(twitch: boolean, youtube: boolean, kick: boolean): void {
    const nextTwitch = showTwitch ? twitch : checks.twitch;
    const nextYoutube = showYoutube ? youtube : checks.youtube;
    const nextKick = showKick ? kick : checks.kick;
    const visibleOn = (showTwitch && nextTwitch) || (showYoutube && nextYoutube) || (showKick && nextKick);
    if (!visibleOn) return;
    onChange(targetFromChecks(nextTwitch, nextYoutube, nextKick));
  }
  const visibleCount = [showTwitch && checks.twitch, showYoutube && checks.youtube, showKick && checks.kick].filter(Boolean).length;
  return (
    <div className="composer-targets">
      {showTwitch ? (
        <CheckRow checked={checks.twitch} disabled={disabled || (checks.twitch && visibleCount === 1)} onChange={(twitch) => commit(twitch, checks.youtube, checks.kick)}>
          Twitch
        </CheckRow>
      ) : null}
      {showYoutube ? (
        <CheckRow checked={checks.youtube} disabled={disabled || (checks.youtube && visibleCount === 1)} onChange={(youtube) => commit(checks.twitch, youtube, checks.kick)}>
          YouTube
        </CheckRow>
      ) : null}
      {showKick ? (
        <CheckRow checked={checks.kick} disabled={disabled || (checks.kick && visibleCount === 1)} onChange={(kick) => commit(checks.twitch, checks.youtube, kick)}>
          Kick
        </CheckRow>
      ) : null}
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
  const checks = checksFromTarget(target);
  const names = [checks.twitch ? "Twitch" : "", checks.youtube ? "YouTube" : "", checks.kick ? "Kick" : ""].filter(Boolean);
  if (names.length === 3) return "Twitch, YouTube, and Kick";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names[0] || "Twitch";
}