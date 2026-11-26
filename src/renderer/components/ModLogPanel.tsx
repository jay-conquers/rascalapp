import type { ModAction } from "../../shared/types";

/** Private to this window. Parents must not pass these rows to an overlay. */
export function ModLogPanel({
  actions,
  enabled,
  twitchMissingReadScopes,
  youtubeConnected,
}: {
  actions: ModAction[];
  enabled: boolean;
  twitchMissingReadScopes: boolean;
  youtubeConnected: boolean;
}) {
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
          {actions.length === 0 ? (
            <p className="count">No moderation actions yet.</p>
          ) : (
            <ol>
              {actions.map((action) => (
                <li key={action.id} className={`mod-entry action-${action.action}`}>
                  <time dateTime={new Date(action.timestamp).toISOString()}>
                    {new Date(action.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </time>
                  <span className="mod-platform">{action.platform === "twitch" ? "Twitch" : "YouTube"}</span>
                  <p>{action.summary}</p>
                </li>
              ))}
            </ol>
          )}
          {twitchMissingReadScopes ? <p className="count">Twitch needs a fresh login with the moderator read scopes.</p> : null}
          {youtubeConnected ? (
            <p className="count mod-caveat">YouTube only lists deletes and bans the page reader includes.</p>
          ) : null}
        </>
      )}
    </aside>
  );
}
