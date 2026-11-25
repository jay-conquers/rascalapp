import type { Dispatch, SetStateAction } from "react";
import type { BotSnapshot } from "../../shared/api";
import { CheckRow } from "./CheckRow";

type Run = (work: () => Promise<BotSnapshot>) => Promise<boolean>;
type SetText = Dispatch<SetStateAction<string>>;

export function BotHooks(props: {
  state: BotSnapshot;
  busy: boolean;
  run: Run;
  hookName: string; setHookName: SetText;
  hookTrigger: string; setHookTrigger: SetText;
  hookKeywords: string; setHookKeywords: SetText;
  hookUrl: string; setHookUrl: SetText;
  hookSecret: string; setHookSecret: SetText;
  hookTimeout: string; setHookTimeout: SetText;
  hookCooldown: string; setHookCooldown: SetText;
  hookUserCooldown: string; setHookUserCooldown: SetText;
  hookLevel: string; setHookLevel: SetText;
  hookReply: "none" | "chat"; setHookReply: Dispatch<SetStateAction<"none" | "chat">>;
  hookEnabled: boolean; setHookEnabled: Dispatch<SetStateAction<boolean>>;
  hookAllowBroadcaster: boolean; setHookAllowBroadcaster: Dispatch<SetStateAction<boolean>>;
  hookId: string; setHookId: SetText;
  hookNote: string; setHookNote: SetText;
}) {
  const {
    state, busy, run,
    hookName, setHookName, hookTrigger, setHookTrigger, hookKeywords, setHookKeywords,
    hookUrl, setHookUrl, hookSecret, setHookSecret, hookTimeout, setHookTimeout,
    hookCooldown, setHookCooldown, hookUserCooldown, setHookUserCooldown,
    hookLevel, setHookLevel, hookReply, setHookReply, hookEnabled, setHookEnabled,
    hookAllowBroadcaster, setHookAllowBroadcaster, hookId, setHookId, hookNote, setHookNote,
  } = props;
  return (
      <section className="bot-card">
        <h3>Chat hooks</h3>
        <p className="form-note">
          Send a chat command to your own service. It stays off until you enable it. The secret is stored in bot.json and is not shown again. Leave the secret blank when you edit a hook to keep the one already saved. After you save, press Test to send a sample and see the status and how long it took.
        </p>
        <ul className="tts-list">
          {state.hooks.length === 0 ? <li>No hooks yet.</li> : null}
          {state.hooks.map((hook) => (
            <li key={hook.id}>
              <p className="tts-line">
                <strong>{hook.name}</strong>
                <span>
                  !{hook.trigger} · {hook.enabled ? "on" : "off"} · {hook.reply === "chat" ? "replies in chat" : "no chat reply"}
                  {hook.secretSet ? " · secret saved" : ""}
                </span>
              </p>
              <p>{hook.url.replace(/[?#].*$/, "")}</p>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setHookId(hook.id);
                  setHookName(hook.name);
                  setHookTrigger(hook.trigger);
                  setHookKeywords((hook.keywords ?? []).join(", "));
                  setHookUrl(hook.url);
                  setHookSecret("");
                  setHookTimeout(String(hook.timeoutMs));
                  setHookCooldown(String(hook.cooldownSec));
                  setHookUserCooldown(String(hook.userCooldownSec));
                  setHookLevel(hook.level);
                  setHookReply(hook.reply);
                  setHookEnabled(hook.enabled);
                  setHookAllowBroadcaster(hook.allowBroadcaster === true);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await window.rascal!.botTestHook(hook.id);
                    setHookNote(`${hook.name}: ${result.ok ? `HTTP ${result.status}` : "failed"} in ${result.ms}ms. ${result.detail}`);
                    return window.rascal!.botState();
                  })
                }
              >
                Test
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => window.rascal!.botDeleteHook(hook.id))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="custom-offset">
          <label>
            Name
            <input value={hookName} onChange={(event) => setHookName(event.target.value)} placeholder="reader" />
          </label>
          <label>
            Command
            <input value={hookTrigger} onChange={(event) => setHookTrigger(event.target.value)} placeholder="ask" />
          </label>
          <label>
            Who can use it
            <select value={hookLevel} onChange={(event) => setHookLevel(event.target.value)}>
              <option value="everyone">Everyone</option>
              <option value="sub">Subscriber</option>
              <option value="mod">Moderator</option>
            </select>
          </label>
        </div>
        <label>
          Keywords, optional
          <input value={hookKeywords} onChange={(event) => setHookKeywords(event.target.value)} placeholder="hey bot" />
        </label>
        <label>
          Address
          <input value={hookUrl} onChange={(event) => setHookUrl(event.target.value)} placeholder="https://example.com/hook or http://127.0.0.1:8787/hook" />
        </label>
        <label>
          Secret
          <input type="password" value={hookSecret} autoComplete="off" onChange={(event) => setHookSecret(event.target.value)} placeholder="Used to sign the body. Leave blank to keep the saved secret." />
        </label>
        <div className="custom-offset">
          <label>
            Timeout ms
            <input value={hookTimeout} onChange={(event) => setHookTimeout(event.target.value)} />
          </label>
          <label>
            Cooldown seconds
            <input value={hookCooldown} onChange={(event) => setHookCooldown(event.target.value)} />
          </label>
          <label>
            Per-viewer cooldown
            <input value={hookUserCooldown} onChange={(event) => setHookUserCooldown(event.target.value)} />
          </label>
          <label>
            Reply
            <select value={hookReply} onChange={(event) => setHookReply(event.target.value === "chat" ? "chat" : "none")}>
              <option value="none">Do not post a reply</option>
              <option value="chat">Post the service reply in chat</option>
            </select>
          </label>
        </div>
        <CheckRow checked={hookEnabled} disabled={busy} onChange={setHookEnabled}>
          Enabled
        </CheckRow>
        <CheckRow checked={hookAllowBroadcaster} disabled={busy} onChange={setHookAllowBroadcaster}>
          Let my own messages trigger this hook
        </CheckRow>
        {hookNote ? <p className="form-note">{hookNote}</p> : null}
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(() =>
              window.rascal!.botSaveHook({
                id: hookId || undefined,
                name: hookName,
                trigger: hookTrigger,
                keywords: hookKeywords.split(",").map((item) => item.trim()).filter(Boolean),
                url: hookUrl,
                secret: hookSecret,
                timeoutMs: Number(hookTimeout) || 5000,
                cooldownSec: Number(hookCooldown) || 0,
                userCooldownSec: Number(hookUserCooldown) || 0,
                level: hookLevel,
                reply: hookReply,
                enabled: hookEnabled,
                allowBroadcaster: hookAllowBroadcaster,
                platforms: "all",
              }),
            ).then((ok) => {
              if (!ok) return;
              setHookSecret("");
              setHookId("");
            })
          }
        >
          Save hook
        </button>
      </section>
  );
}
