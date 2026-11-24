import { useState } from "react";
import { TWITCH_MESSAGE_MAX } from "../../shared/defaults";
import { planSend, type PlatformLink, type SendTargets } from "../../shared/send-targets";
import { CheckRow } from "./CheckRow";

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
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = planSend(targets, { twitch, youtube });
  const canDeliver = plan.deliver.twitch || plan.deliver.youtube;
  const limit = targets.youtube ? YOUTUBE_MESSAGE_MAX : TWITCH_MESSAGE_MAX;
  const remaining = limit - text.length;

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
        <textarea
          id="composer"
          data-testid="composer-input"
          rows={1}
          value={text}
          maxLength={Math.max(limit, text.length)}
          disabled={sending}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
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
