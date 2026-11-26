import { platformLabel } from "../../shared/platform/selection";
import type { ModAction } from "../../shared/types";

/** Private to this window. Parents must not pass these rows to an overlay. */
export function ModLogPanel({
  actions,
  enabled,
  enabledIds,
  twitchMissingReadScopes,
  youtubeConnected,
}: {
  actions: ModAction[];
  enabled: boolean;
  enabledIds?: readonly string[];
  twitchMissingReadScopes: boolean;
  youtubeConnected: boolean;
}) {
  const shown = enabledIds ? actions.filter((action) => enabledIds.includes(action.platform)) : actions;
  const showTwitchNote = twitchMissingReadScopes && (!enabledIds || enabledIds.includes("twitch"));
  const showYoutubeNote = youtubeConnected && (!enabledIds || enabledIds.includes("youtube"));
  return (
    <aside className="mod-log" data-testid="mod-log" aria-label="Private mod log">
      <header>
        <h2>Mod log</h2>
        <span className="private-tag">Private · not sent to chat or overlays</span>
      </header>
      {!enabled ? (
        <p className="count">The mod log is off. Turn it on in Settings to record timeouts, bans, deletes, and mode changes.</p>
      ) : (
        <>
          {shown.length === 0 ? (
            <p className="count">No moderation actions yet.</p>
          ) : (
            <ol>
              {shown.map((action) => (
                <li key={action.id} className={`mod-entry action-${action.action}`}>
                  <time dateTime={new Date(action.timestamp).toISOString()}>
                    {new Date(action.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </time>
                  <span className="mod-platform">{platformLabel(action.platform)}</span>
                  <p>{action.summary}</p>
                </li>
              ))}
            </ol>
          )}
          {showTwitchNote ? <p className="count">Twitch needs a fresh login with the moderator read scopes.</p> : null}
          {showYoutubeNote ? (
            <p className="count mod-caveat">YouTube only lists deletes and bans the page reader includes.</p>
          ) : null}
        </>
      )}
    </aside>
  );
}
