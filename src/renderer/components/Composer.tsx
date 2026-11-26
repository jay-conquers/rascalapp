import { useEffect, useRef, useState } from "react";
import { TWITCH_MESSAGE_MAX } from "../../shared/defaults";
import { applyMention, mentionToken, stepMention, type MentionRoster, type MentionSuggestion } from "../../shared/mentions";
import { planSend, type PlatformLink, type SendTargets } from "../../shared/send-targets";
import { CheckRow } from "./CheckRow";
import { TwitchMark, YouTubeMark } from "./icons";

const YOUTUBE_MESSAGE_MAX = 200;

export function Composer({
  channel,
  targets,
  onTargets,
  twitch,
  youtube,
  canSendYoutube,
  youtubeAccount,
  sendHint,
  onOpenSettings,
  onOpenBot,
  onSend,
  loadMentions,
}: {
  channel: string;
  targets: SendTargets;
  onTargets: (next: SendTargets) => void;
  twitch: PlatformLink;
  youtube: PlatformLink;
  canSendYoutube: boolean;
  youtubeAccount: string | null;
  sendHint?: string;
  onOpenSettings?: () => void;
  onOpenBot?: () => void;
  onSend: (text: string, destinations: { twitch: boolean; youtube: boolean }) => Promise<void>;
  loadMentions?: (query: string) => Promise<MentionRoster>;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [marked, setMarked] = useState(false);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const token = mentionToken(text, cursor);
  const tokenKey = token ? `${token.start}:${token.query}` : "";
  const listOpen = Boolean(token) && dismissed !== tokenKey && suggestions.length > 0;
  const selected = suggestions.length === 0 ? 0 : Math.min(index, suggestions.length - 1);
  const plan = planSend(targets, { twitch, youtube });
  const canDeliver = plan.deliver.twitch || plan.deliver.youtube;
  const limit = targets.youtube ? YOUTUBE_MESSAGE_MAX : TWITCH_MESSAGE_MAX;
  const remaining = limit - text.length;

  useEffect(() => {
    if (!tokenKey || !loadMentions) {
      setSuggestions([]);
      setMarked(false);
      return;
    }
    const query = tokenKey.slice(tokenKey.indexOf(":") + 1);
    let cancel = false;
    const timer = setTimeout(() => {
      void loadMentions(query)
        .then((roster) => {
          if (cancel) return;
          setSuggestions(roster.suggestions);
          setMarked(roster.active.length > 1);
          setIndex(0);
        })
        .catch(() => {
          if (cancel) return;
          setSuggestions([]);
          setMarked(false);
        });
    }, 80);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [tokenKey, loadMentions]);

  function syncCursor(next = box.current?.selectionStart ?? cursor): void {
    setCursor(next);
  }

  function choose(name: string): void {
    if (!token) return;
    const next = applyMention(text, token.start, cursor, name);
    setText(next.text);
    setCursor(next.cursor);
    setSuggestions([]);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function submit(): Promise<void> {
    if (sending || !text.trim()) return;
    if (!canDeliver) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text, plan.deliver);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  const placeholder = canDeliver
    ? plan.deliver.youtube && !plan.deliver.twitch
      ? "Message YouTube chat"
      : channel
        ? `Message #${channel}`
        : "Message"
    : plan.offline.youtube
      ? "YouTube is offline. The check stays on."
      : canSendYoutube
        ? "Choose a platform to send"
        : "Log in with Twitch to send chat";

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="composer-targets">
        <CheckRow id="send-twitch" checked={targets.twitch} onChange={(checked) => onTargets({ ...targets, twitch: checked })}>
          {channel ? `Twitch as ${channel}` : "Twitch"}
          {plan.offline.twitch ? <em className="offline-note">offline</em> : null}
        </CheckRow>
        <CheckRow id="send-youtube" checked={targets.youtube} onChange={(checked) => onTargets({ ...targets, youtube: checked })}>
          {youtubeAccount ? `YouTube as ${youtubeAccount}` : "YouTube"}
          {plan.offline.youtube ? <em className="offline-note">offline</em> : null}
        </CheckRow>
      </div>
      {!canSendYoutube ? (
        <div className="form-note youtube-send-hint" data-testid="youtube-send-hint">
          <p>
            {sendHint ||
              "YouTube sending isn't set up yet. The check stays as you left it, and messages skip YouTube until then. Reading chat still works without Google: put the channel ID in Settings. To send, open the Bot tab, save a Google OAuth client, and connect an account. That login asks for youtube.force-ssl."}
          </p>
          <div className="tts-actions">
            {onOpenBot ? (
              <button type="button" className="ghost" onClick={onOpenBot}>
                Open Bot
              </button>
            ) : null}
            {onOpenSettings ? (
              <button type="button" className="ghost" onClick={onOpenSettings}>
                Open Settings
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="composer-row">
        {listOpen ? (
          <ul className="mention-list" role="listbox" data-testid="mention-list" aria-label="Mention suggestions">
            {suggestions.map((suggestion, itemIndex) => (
              <li key={`${suggestion.platform}:${suggestion.name}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={itemIndex === selected}
                  className={itemIndex === selected ? "active" : ""}
                  onMouseEnter={() => setIndex(itemIndex)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(suggestion.name)}
                >
                  {marked ? <PlatformMark platform={suggestion.platform} label={suggestion.label} /> : null}
                  <span>@{suggestion.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          id="composer"
          ref={box}
          data-testid="composer-input"
          rows={1}
          value={text}
          maxLength={Math.max(limit, text.length)}
          disabled={sending}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          onChange={(event) => {
            setText(event.target.value);
            setCursor(event.target.selectionStart ?? event.target.value.length);
          }}
          onClick={() => syncCursor()}
          onSelect={() => syncCursor()}
          onKeyUp={() => syncCursor()}
          onKeyDown={(event) => {
            if (listOpen && event.key === "ArrowDown") {
              event.preventDefault();
              setIndex(stepMention(selected, suggestions.length, 1));
              return;
            }
            if (listOpen && event.key === "ArrowUp") {
              event.preventDefault();
              setIndex(stepMention(selected, suggestions.length, -1));
              return;
            }
            if (listOpen && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
              event.preventDefault();
              const pick = suggestions[selected];
              if (pick) choose(pick.name);
              return;
            }
            if (token && event.key === "Escape") {
              event.preventDefault();
              setDismissed(tokenKey);
              setSuggestions([]);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button className="primary" type="submit" disabled={sending || !text.trim() || remaining < 0 || !canDeliver}>
          {sending ? "Sending" : "Send"}
        </button>
      </div>
      <div className="composer-meta">
        {error ? <span className="form-error">{error}</span> : <span>{targets.youtube ? "YouTube live chat stops at 200 characters." : "Twitch messages stop at 500 characters."}</span>}
        {text.length > limit - 40 && <span className={remaining < 0 ? "form-error" : ""}>{remaining}</span>}
      </div>
    </form>
  );
}

function PlatformMark({ platform, label }: { platform: string; label: string }) {
  return (
    <span className={`mention-mark ${platform}`} title={label} aria-label={label}>
      {platform === "twitch" ? <TwitchMark /> : platform === "youtube" ? <YouTubeMark /> : label.slice(0, 1)}
    </span>
  );
}
