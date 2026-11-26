import { useState } from "react";
import { offerHint, parseTimeoutDuration, TIMEOUT_PRESETS, type DeskModerationAction, type ModerationOffer } from "../../shared/moderation";
import type { ChatMessage } from "../../shared/types";

export function ModMenu({
  message,
  offer,
  x,
  y,
  onModerate,
  onClose,
}: {
  message: ChatMessage;
  offer: ModerationOffer;
  x: number;
  y: number;
  onModerate: (command: { action: DeskModerationAction; seconds?: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hint = offerHint(offer);
  const platform = message.platform === "twitch" ? "Twitch" : message.platform === "kick" ? "Kick" : "YouTube";

  async function run(action: DeskModerationAction, seconds?: number): Promise<void> {
    const gate = action === "timeout" ? offer.timeout : offer[action];
    if (!gate.enabled) {
      setError(gate.reason);
      return;
    }
    if (action === "ban" && !confirming) {
      setError(null);
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onModerate(action === "timeout" ? { action, seconds } : { action });
      onClose();
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : "That moderation action failed.");
    } finally {
      setBusy(false);
    }
  }

  function applyCustom(): void {
    const seconds = parseTimeoutDuration(custom);
    if (seconds === null) {
      setError("Enter a timeout from 1 second to 14 days.");
      return;
    }
    void run("timeout", seconds);
  }

  return (
    <div
      className="mod-menu"
      style={{ left: x, top: y }}
      role="menu"
      data-testid="mod-menu"
      aria-label={`Moderation for ${message.displayName}`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="mod-menu-title">
        {message.displayName}
        <span>{platform}</span>
      </p>
      <button type="button" role="menuitem" disabled={busy || !offer.delete.enabled} title={offer.delete.reason} onClick={() => void run("delete")}>
        Delete message
      </button>
      <div className="mod-timeouts" role="group" aria-label="Timeout">
        {TIMEOUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={busy || !offer.timeout.enabled}
            title={offer.timeout.reason}
            onClick={() => void run("timeout", preset.seconds)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mod-custom">
        <input
          value={custom}
          disabled={busy || !offer.timeout.enabled}
          placeholder="Custom, such as 90s or 5m"
          aria-label="Custom timeout"
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyCustom();
            }
          }}
        />
        <button type="button" disabled={busy || !offer.timeout.enabled} onClick={applyCustom}>
          Timeout
        </button>
      </div>
      {confirming ? (
        <div className="mod-confirm">
          <p>Ban {message.displayName}? They stay out until someone unbans them.</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void run("ban")}>
            Ban
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" role="menuitem" disabled={busy || !offer.ban.enabled} title={offer.ban.reason} onClick={() => void run("ban")}>
          Ban
        </button>
      )}
      <button type="button" role="menuitem" disabled={busy || !offer.unban.enabled} title={offer.unban.reason} onClick={() => void run("unban")}>
        Unban
      </button>
      {hint ? <p className="mod-note">{hint}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
