import { useEffect, useRef, useState } from "react";
import { showsAuthorName } from "../../shared/chat-author";
import { emptyFeedCopy, platformLabel, type PlatformSelection } from "../../shared/platform/selection";
import type { DeskModerationAction, ModerationOffer } from "../../shared/moderation";
import type { ChatMessage, EmoteSegment, Segment } from "../../shared/types";
import { TwitchMark, YouTubeMark } from "./icons";
import { ModMenu } from "./ModMenu";

export function ChatFeed({
  messages,
  enabledIds,
  offerFor,
  onModerate,
}: {
  messages: ChatMessage[];
  enabledIds?: readonly string[];
  offerFor?: (message: ChatMessage) => ModerationOffer;
  onModerate?: (message: ChatMessage, command: { action: DeskModerationAction; seconds?: number }) => Promise<void>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [pending, setPending] = useState(0);
  const [menu, setMenu] = useState<{ message: ChatMessage; x: number; y: number } | null>(null);
  const shown = enabledIds ? messages.filter((message) => enabledIds.includes(message.platform)) : messages;
  const lastId = shown[shown.length - 1]?.id ?? "";
  const selection = enabledIds ? ({ confirmed: true, enabled: [...enabledIds] } satisfies PlatformSelection) : undefined;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stuck.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    setPending((count) => count + 1);
  }, [lastId]);

  function onScroll(): void {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const next = distance < 56;
    stuck.current = next;
    if (next) setPending(0);
  }

  useEffect(() => {
    if (!menu) return;
    function onPointer(event: MouseEvent): void {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function place(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const maxX = Math.max(8, window.innerWidth - 248);
    const maxY = Math.max(8, window.innerHeight - 320);
    return {
      x: Math.min(Math.max(8, event.clientX), maxX),
      y: Math.min(Math.max(8, event.clientY), maxY),
    };
  }

  function openMenu(event: { clientX: number; clientY: number; preventDefault: () => void }, message: ChatMessage): void {
    if (!offerFor || !onModerate) return;
    event.preventDefault();
    setMenu({ message, ...place(event) });
  }

  function jump(): void {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setPending(0);
  }

  return (
    <div className="feed-wrap">
      <div className="feed" ref={scroller} onScroll={onScroll} data-testid="chat-feed">
        {shown.length === 0 ? (
          <div className="empty">
            <p>No messages yet.</p>
            <p>{selection ? emptyFeedCopy(selection) : "Twitch chat joins on its own. YouTube chat attaches when the channel goes live."}</p>
          </div>
        ) : (
          shown.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onOpen={(event) => openMenu(event, message)}
              canModerate={Boolean(offerFor && onModerate)}
            />
          ))
        )}
      </div>
      {menu && offerFor && onModerate ? (
        <div ref={menuRef}>
          <ModMenu
            message={menu.message}
            offer={offerFor(menu.message)}
            x={menu.x}
            y={menu.y}
            onModerate={(command) => onModerate(menu.message, command)}
            onClose={() => setMenu(null)}
          />
        </div>
      ) : null}
      {pending > 0 && (
        <button className="jump" type="button" onClick={jump}>
          {pending} new · jump to latest
        </button>
      )}
    </div>
  );
}

function MessageRow({
  message,
  onOpen,
  canModerate,
}: {
  message: ChatMessage;
  onOpen: (event: { clientX: number; clientY: number; preventDefault: () => void; button: number }) => void;
  canModerate: boolean;
}) {
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const label = platformLabel(message.platform);
  const named = showsAuthorName(message);
  return (
    <article
      className={`msg kind-${message.kind}${message.noticeKind ? ` notice-${message.noticeKind}` : ""}${message.deskOnly ? " desk-only" : ""}${message.deleted ? " deleted" : ""}`}
      data-platform={message.platform}
      onClick={(event) => {
        if (!canModerate || event.button !== 0) return;
        if (window.getSelection()?.toString()) return;
        onOpen(event);
      }}
      onContextMenu={(event) => {
        if (!canModerate) return;
        onOpen(event);
      }}
    >
      <span className={`platform ${message.platform}`} title={label} aria-label={label}>
        {message.platform === "twitch" ? <TwitchMark /> : message.platform === "youtube" ? <YouTubeMark /> : label.slice(0, 1)}
      </span>
      <div className="msg-main">
        {message.notice && <p className="notice">{message.notice}</p>}
        <div className="msg-line">
          {named ? (
            <button
              type="button"
              className="who who-button"
              data-testid="author-name"
              style={{ color: message.color }}
              onClick={(event) => {
                event.stopPropagation();
                if (!canModerate) return;
                onOpen(event);
              }}
              onContextMenu={(event) => {
                event.stopPropagation();
                if (!canModerate) return;
                onOpen(event);
              }}
            >
              {message.displayName}
            </button>
          ) : null}
          <span className="badges">
            {message.badges.map((badge) => (
              <span key={badge.kind} className={`badge ${badge.kind}`} title={badge.detail ? `${badge.label} ${badge.detail}` : badge.label}>
                {badge.label}
                {badge.detail ? <em>{badge.detail}</em> : null}
              </span>
            ))}
          </span>
          {message.amount && <span className="amount">{message.amount}</span>}
          <span className={`body${message.kind === "action" ? " action" : ""}`}>
            {message.segments.map((segment, index) => (
              <SegmentView key={`${message.id}-${index}`} segment={segment} />
            ))}
          </span>
        </div>
      </div>
      <time dateTime={new Date(message.timestamp).toISOString()}>{time}</time>
    </article>
  );
}

function SegmentView({ segment }: { segment: Segment }) {
  if (segment.type === "text") return <span>{segment.text}</span>;
  return <EmoteImage segment={segment} />;
}

function EmoteImage({ segment }: { segment: EmoteSegment }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span>{segment.text}</span>;
  return (
    <img
      className="emote"
      src={segment.url}
      alt={segment.text}
      title={`${segment.text} · ${segment.source}`}
      onError={() => setFailed(true)}
    />
  );
}
