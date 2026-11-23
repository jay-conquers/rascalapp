import { useState } from "react";
import { TWITCH_MESSAGE_MAX } from "../../shared/defaults";
import { CheckRow } from "./CheckRow";

const YOUTUBE_MESSAGE_MAX = 200;

export function Composer({
  channel,
  canSendTwitch,
  canSendYoutube,
  youtubeAccount,
  onSend,
}: {
  channel: string;
  canSendTwitch: boolean;
  canSendYoutube: boolean;
  youtubeAccount: string | null;
  onSend: (text: string, destinations: { twitch: boolean; youtube: boolean }) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toTwitch, setToTwitch] = useState(true);
  const [toYoutube, setToYoutube] = useState(false);
  const sendTwitch = toTwitch && canSendTwitch;
  const sendYoutube = toYoutube && canSendYoutube;
  const canSend = sendTwitch || sendYoutube;
  const limit = sendYoutube ? YOUTUBE_MESSAGE_MAX : TWITCH_MESSAGE_MAX;
  const remaining = limit - text.length;

  async function submit(): Promise<void> {
    if (!canSend || sending || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text, { twitch: sendTwitch, youtube: sendYoutube });
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  const placeholder = canSend
    ? sendYoutube && !sendTwitch
      ? "Message YouTube chat"
      : channel
        ? `Message #${channel}`
        : "Message"
    : canSendYoutube
      ? "Choose YouTube to send without Twitch"
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
        <CheckRow checked={toTwitch} disabled={!canSendTwitch} onChange={setToTwitch}>
          {channel ? `Twitch as ${channel}` : "Twitch"}
        </CheckRow>
        <CheckRow checked={toYoutube} disabled={!canSendYoutube} onChange={setToYoutube}>
          {youtubeAccount ? `YouTube as ${youtubeAccount}` : "YouTube"}
        </CheckRow>
      </div>
      <div className="composer-row">
        <textarea
          id="composer"
          data-testid="composer-input"
          rows={1}
          value={text}
          maxLength={Math.max(limit, text.length)}
          disabled={!canSend || sending}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button className="primary" type="submit" disabled={!canSend || sending || !text.trim() || remaining < 0}>
          {sending ? "Sending" : "Send"}
        </button>
      </div>
      <div className="composer-meta">
        {error ? <span className="form-error">{error}</span> : <span>{sendYoutube ? "YouTube live chat stops at 200 characters." : "Twitch messages stop at 500 characters."}</span>}
        {text.length > limit - 40 && <span className={remaining < 0 ? "form-error" : ""}>{remaining}</span>}
      </div>
    </form>
  );
}
