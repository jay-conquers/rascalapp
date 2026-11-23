import { useState } from "react";
import { TWITCH_MESSAGE_MAX } from "../../shared/defaults";

export function Composer({
  channel,
  canSend,
  onSend,
}: {
  channel: string;
  canSend: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = TWITCH_MESSAGE_MAX - text.length;

  async function submit(): Promise<void> {
    if (!canSend || sending || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="composer-label" htmlFor="composer">
        {channel ? `Send to Twitch as ${channel}` : "Send to Twitch"}
      </label>
      <div className="composer-row">
        <textarea
          id="composer"
          data-testid="composer-input"
          rows={1}
          value={text}
          maxLength={TWITCH_MESSAGE_MAX}
          disabled={!canSend || sending}
          placeholder={canSend ? (channel ? `Message #${channel}` : "Message") : "Log in with Twitch to send chat"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button className="primary" type="submit" disabled={!canSend || sending || !text.trim()}>
          {sending ? "Sending" : "Send"}
        </button>
      </div>
      <div className="composer-meta">
        {error ? <span className="form-error">{error}</span> : <span>YouTube send is not in this build.</span>}
        {text.length > 400 && <span className={remaining < 0 ? "form-error" : ""}>{remaining}</span>}
      </div>
    </form>
  );
}
