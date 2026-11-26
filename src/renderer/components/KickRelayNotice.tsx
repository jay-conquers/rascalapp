import { useState } from "react";
import { KICK_RELAY_DOCS_URL } from "../../shared/kick/docs";
import { CheckRow } from "./CheckRow";

/**
 * Shown when Kick is turned on, until the acknowledgement is saved.
 * The confirm button stays off until the checkbox is ticked. Cancel leaves Kick off.
 */
export function KickRelayNotice({
  understood,
  confirmLabel,
  onUnderstand,
  onCancel,
  onConfirm,
  onOpenDocs,
}: {
  understood: boolean;
  confirmLabel: string;
  onUnderstand: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenDocs?: (url: string) => void;
}) {
  return (
    <div className="modal-back" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="kick-relay-title" data-testid="kick-relay-notice">
        <h2 id="kick-relay-title">Kick needs a relay</h2>
        <p>
          Kick sends chat and events only as webhooks, and a webhook needs a public address. Kick works with Rascal hosting, or with a relay you run yourself. Rascal hosting is not available yet. It is coming later.
        </p>
        <p>Without hosting or a relay, Kick chat and events will not work.</p>
        <p>
          <a
            href={KICK_RELAY_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (!onOpenDocs) return;
              event.preventDefault();
              onOpenDocs(KICK_RELAY_DOCS_URL);
            }}
          >
            Self-hosting instructions
          </a>
        </p>
        <CheckRow id="kick-understand" checked={understood} onChange={onUnderstand}>
          I understand
        </CheckRow>
        <div className="tts-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" data-testid="kick-relay-confirm" disabled={!understood} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function KickRelayDialog({
  confirmLabel,
  onCancel,
  onConfirm,
  onOpenDocs,
}: {
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenDocs?: (url: string) => void;
}) {
  const [understood, setUnderstood] = useState(false);
  return (
    <KickRelayNotice
      understood={understood}
      confirmLabel={confirmLabel}
      onUnderstand={setUnderstood}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onOpenDocs={onOpenDocs}
    />
  );
}
