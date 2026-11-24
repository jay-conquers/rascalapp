import { useEffect, useRef, useState } from "react";
import type { ChatMessage, EmoteSegment, Segment } from "../../shared/types";
import { TwitchMark, YouTubeMark } from "./icons";

export function ChatFeed({ messages }: { messages: ChatMessage[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [pending, setPending] = useState(0);
  const lastId = messages[messages.length - 1]?.id ?? "";

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
        {messages.length === 0 ? (
          <div className="empty">
            <p>No messages yet.</p>
            <p>Twitch chat joins on its own. YouTube chat attaches when the channel goes live.</p>
          </div>
        ) : (
          messages.map((message) => <MessageRow key={message.id} message={message} />)
        )}
      </div>
      {pending > 0 && (
        <button className="jump" type="button" onClick={jump}>
          {pending} new · jump to latest
        </button>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const platformLabel = message.platform === "twitch" ? "Twitch" : "YouTube";
  return (
    <article
      className={`msg kind-${message.kind}${message.noticeKind ? ` notice-${message.noticeKind}` : ""}${message.deskOnly ? " desk-only" : ""}${message.deleted ? " deleted" : ""}`}
      data-platform={message.platform}
    >
      <span className={`platform ${message.platform}`} title={platformLabel} aria-label={platformLabel}>
        {message.platform === "twitch" ? <TwitchMark /> : <YouTubeMark />}
      </span>
      <div className="msg-main">
        {message.notice && <p className="notice">{message.notice}</p>}
        <div className="msg-line">
          {message.kind !== "system" || message.segments.length > 0 ? (
            <span className="who" style={{ color: message.color }}>
              {message.displayName}
            </span>
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
