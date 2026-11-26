import { useState } from "react";
import { visiblePlatforms, enableKick, requestPlatformToggle, type PlatformSelection } from "../../shared/platform/selection";
import { RascalMark } from "./icons";
import { CheckRow } from "./CheckRow";
import { KickRelayDialog } from "./KickRelayNotice";

/** The same list the first-run screen and Settings use. */
export function PlatformPicker({
  selection,
  onToggle,
}: {
  selection: PlatformSelection;
  onToggle: (id: string, on: boolean) => void;
}) {
  const visible = visiblePlatforms();
  return (
    <div className="platform-picker" data-testid="platform-picker">
      {visible.map((entry) => {
        const on = selection.enabled.includes(entry.id);
        const last = on && selection.enabled.length === 1;
        return (
          <CheckRow key={entry.id} id={`platform-${entry.id}`} checked={on} disabled={last} onChange={(checked) => onToggle(entry.id, checked)}>
            {entry.label}
            {last ? <span className="count"> At least one platform stays on.</span> : null}
          </CheckRow>
        );
      })}
    </div>
  );
}

export function FirstRunPlatforms({
  initial,
  busy,
  error,
  onContinue,
}: {
  initial: PlatformSelection;
  busy: boolean;
  error: string | null;
  onContinue: (selection: PlatformSelection) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState(false);
  return (
    <main className="first-run">
      <section className="first-run-card" data-testid="first-run">
        <RascalMark className="boot-mark" />
        <h1>Which platforms do you stream on?</h1>
        <p>
          Choose at least one. You can change this later in Settings. Turning a platform off hides it and stops its connection. Your logins stay saved.
        </p>
        <PlatformPicker
          selection={draft}
          onToggle={(id, on) => {
            try {
              const result = requestPlatformToggle(draft, id, on);
              setDraft(result.next);
              if (result.confirmKick) setNotice(true);
            } catch {
              setDraft(draft);
            }
          }}
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary" type="button" disabled={busy || draft.enabled.length === 0} onClick={() => onContinue(draft)}>
          {busy ? "Saving" : "Continue"}
        </button>
      </section>
      {notice ? (
        <KickRelayDialog
          confirmLabel="Continue"
          onOpenDocs={(url) => void window.rascal?.openExternal(url)}
          onCancel={() => setNotice(false)}
          onConfirm={() => {
            setDraft(enableKick(draft));
            setNotice(false);
          }}
        />
      ) : null}
    </main>
  );
}
