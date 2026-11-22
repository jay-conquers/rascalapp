import { brand } from "../../shared/brand";
import type { LoginPrompt } from "../../shared/types";

export function LoginDialog({
  login,
  onOpen,
  onCancel,
}: {
  login: LoginPrompt;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const grouped = login.userCode.length === 8 ? `${login.userCode.slice(0, 4)}-${login.userCode.slice(4)}` : login.userCode;
  return (
    <div className="modal-back" role="presentation">
      <div className="modal" role="dialog" aria-labelledby="login-title" data-testid="login-dialog">
        <h2 id="login-title">Approve {brand.displayName} on Twitch</h2>
        <p>In the browser, confirm this code. It expires on its own if you wait.</p>
        <p className="device-code">{grouped}</p>
        <div className="form-actions">
          <button type="button" className="primary" onClick={onOpen}>
            Open Twitch
          </button>
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p className="count">Waiting for approval…</p>
      </div>
    </div>
  );
}
