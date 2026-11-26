import type { Dispatch, SetStateAction } from "react";
import { brand } from "../../shared/brand";
import type { BotSnapshot } from "../../shared/api";
import type { ShoutoutSettings, ThanksSettings } from "../../../packages/bot/src/model";
import { CheckRow } from "./CheckRow";
import { visiblePlatforms } from "../../shared/platform/selection";
import { PlatformChecks, TimerEditor } from "./bot-editors";

const THANK_ROWS: { key: keyof ThanksSettings; label: string }[] = [
  { key: "follow", label: "Follow" },
  { key: "sub", label: "Subscription" },
  { key: "resub", label: "Resubscription" },
  { key: "subgift", label: "Gifted sub" },
  { key: "cheer", label: "Cheer" },
  { key: "raid", label: "Raid" },
  { key: "redemption", label: "Channel point redeem" },
];

type Run = (work: () => Promise<BotSnapshot>) => Promise<boolean>;

export function BotLibrary(props: {
  state: BotSnapshot;
  busy: boolean;
  run: Run;
  setError: (message: string) => void;
  shoutout: ShoutoutSettings;
  setShoutout: Dispatch<SetStateAction<ShoutoutSettings>>;
  quoteImport: string;
  setQuoteImport: Dispatch<SetStateAction<string>>;
  thanks: ThanksSettings;
  setThanks: Dispatch<SetStateAction<ThanksSettings>>;
  words: string;
  setWords: Dispatch<SetStateAction<string>>;
  jwt: string;
  setJwt: Dispatch<SetStateAction<string>>;
  jsonText: string;
  setJsonText: Dispatch<SetStateAction<string>>;
  enabledIds?: readonly string[];
}) {
  const { state, busy, run, setError, shoutout, setShoutout, quoteImport, setQuoteImport, thanks, setThanks, words, setWords, jwt, setJwt, jsonText, setJsonText } = props;
  const enabled = props.enabledIds ?? visiblePlatforms().map((entry) => entry.id);
  const showTwitch = enabled.includes("twitch");
  return (
<>
      {showTwitch ? (
      <section className="bot-card">
        <h3>Shoutout</h3>
        <p className="form-note">Mods use !so username. Rascal posts this line with the target's login and the game Helix last had on their channel. A custom !so still works for viewers who are not mods.</p>
        <label>
          Shoutout line
          <textarea value={shoutout.template} onChange={(event) => setShoutout({ ...shoutout, template: event.target.value })} />
        </label>
        <CheckRow checked={shoutout.helix} disabled={busy} onChange={(helix) => setShoutout({ ...shoutout, helix })}>
          Also send a Twitch shoutout when the bot token has moderator:manage:shoutouts
        </CheckRow>
        <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.botSaveExtras({ shoutout }))}>
          Save shoutout
        </button>
      </section>
      ) : null}

      <section className="bot-card">
        <h3>Quotes</h3>
        <p className="form-note">Everyone can use !quote or !quote 3. Mods can !quote add text and !quote remove 3. Numbers stay put after a removal.</p>
        <ul className="tts-list">
          {state.quotes.length === 0 ? <li>No quotes yet.</li> : null}
          {state.quotes.map((quote) => (
            <li key={quote.id}>
              <p className="tts-line">
                <strong>#{quote.id}</strong>
                <span>{quote.by}</span>
              </p>
              <p>{quote.text}</p>
            </li>
          ))}
        </ul>
        <label>
          Import quotes, one JSON list
          <textarea value={quoteImport} onChange={(event) => setQuoteImport(event.target.value)} placeholder='["first quote", {"text": "second"}]' />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            try {
              const quotes = JSON.parse(quoteImport) as unknown;
              if (!Array.isArray(quotes)) {
                setError("Paste a JSON list of quotes.");
                return;
              }
              void run(() => window.rascal!.botSaveExtras({ quotes })).then(() => setQuoteImport(""));
            } catch {
              setError("That quote list could not be read.");
            }
          }}
        >
          Import quotes
        </button>
      </section>

      <section className="bot-card">
        <h3>Chat thank-yous</h3>
        <p className="form-note">
          Off until you turn one on. The bot account posts the line when that notice is shown in chat. A hidden notice, or a duplicate Rascal already dropped, does not get a thank-you. Gifted subs from the same person a few seconds apart become one line.
        </p>
        {THANK_ROWS.map((row) => (
          <div key={row.key}>
            <CheckRow
              checked={thanks[row.key].enabled}
              disabled={busy}
              onChange={(enabled) => setThanks({ ...thanks, [row.key]: { ...thanks[row.key], enabled } })}
            >
              {row.label}
            </CheckRow>
            <label>
              {row.label} line
              <input
                value={thanks[row.key].template}
                onChange={(event) => setThanks({ ...thanks, [row.key]: { ...thanks[row.key], template: event.target.value } })}
              />
            </label>
          </div>
        ))}
        <p className="form-note">Variables: {"{user}"} {"{amount}"} {"{count}"}</p>
        <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.botSaveExtras({ thanks }))}>
          Save thank-yous
        </button>
      </section>

      <section className="bot-card">
        <h3>Timers</h3>
        <p className="form-note">
          A timer can run while the stream is live, while it is offline, or both. Each side has its own interval and chat-line minimum. Put one message per line and Rascal rotates through them. Live and offline come from Twitch and, when the page reader has an answer, from YouTube. YouTube only posts while that channel is live.
        </p>
        {state.timers.map((timer) => (
          <TimerEditor
            key={timer.id}
            timer={timer}
            busy={busy}
            enabledIds={enabled}
            onSave={(input) => run(() => window.rascal!.botSaveTimer(input))}
            onDelete={() => run(() => window.rascal!.botDeleteTimer(timer.id))}
          />
        ))}
        <h3>New timer</h3>
        <TimerEditor busy={busy} timer={null} enabledIds={enabled} onSave={(input) => run(() => window.rascal!.botSaveTimer(input))} />
      </section>

      <section className="bot-card">
        <h3>Filters</h3>
        <PlatformChecks
          target={state.filters.platforms}
          disabled={busy}
          enabledIds={enabled}
          onChange={(platforms) => void run(() => window.rascal!.botSaveFilters({ platforms }))}
        />
        <CheckRow
          checked={state.filters.links.enabled}
          onChange={(enabled) => void run(() => window.rascal!.botSaveFilters({ links: { enabled, action: "delete", timeoutSec: 30 } }))}
        >
          Delete links unless a mod used !permit
        </CheckRow>
        <CheckRow
          checked={state.filters.caps.enabled}
          onChange={(enabled) => void run(() => window.rascal!.botSaveFilters({ caps: { ...state.filters.caps, enabled } }))}
        >
          Caps limit ({state.filters.caps.maxPercent}% after {state.filters.caps.minLength} letters)
        </CheckRow>
        <CheckRow
          checked={state.filters.symbols.enabled}
          onChange={(enabled) => void run(() => window.rascal!.botSaveFilters({ symbols: { ...state.filters.symbols, enabled } }))}
        >
          Symbol spam limit
        </CheckRow>
        <label>
          Blacklist, one per line: word, delete|timeout|ban, seconds
          <textarea value={words} onChange={(event) => setWords(event.target.value)} />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            const blacklist = words
              .split(/\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [word, action, seconds] = line.split(",").map((part) => part.trim());
                return { word, action: action === "timeout" || action === "ban" ? action : "delete", timeoutSec: Number(seconds) || 60 };
              });
            void run(() => window.rascal!.botSaveFilters({ blacklist }));
          }}
        >
          Save blacklist
        </button>
      </section>

      <section className="bot-card">
        <h3>Import</h3>
        <label>
          StreamElements JWT
          <input type="password" value={jwt} autoComplete="off" onChange={(event) => setJwt(event.target.value)} placeholder={state.seJwtSet ? "A JWT is already stored" : "Paste the channel JWT"} />
        </label>
        <button type="button" className="primary" disabled={busy || (!jwt.trim() && !state.seJwtSet)} onClick={() => void run(() => window.rascal!.botImportSe(jwt)).then(() => setJwt(""))}>
          Import commands and timers
        </button>
        <p className="form-note">{state.seJwtSet ? "Leave the field blank to import again with the stored JWT. Pasting a new one replaces it." : "The JWT is stored on this computer and is not shown again."}</p>
        <label>
          JSON import
          <textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder='{"commands":[{"name":"so","response":"Go see {touser}"}]}' />
          <span className="hint">
            Paste {brand.exportFile}.
          </span>
        </label>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            try {
              void run(() => window.rascal!.botImportJson(JSON.parse(jsonText) as unknown));
            } catch {
              setError("That JSON could not be read.");
            }
          }}
        >
          Import JSON
        </button>
      </section>

      <section className="bot-card">
        <h3>Mod log</h3>
        <ul className="tts-recent">
          {state.log.length === 0 ? <li>No bot actions yet.</li> : null}
          {state.log.slice().reverse().map((entry, index) => (
            <li key={`${entry.t}-${index}`}>
              <strong>{entry.action}</strong> <em>{entry.user}</em>
              <p>{entry.text}</p>
            </li>
          ))}
        </ul>
      </section>
</>
  );
}
