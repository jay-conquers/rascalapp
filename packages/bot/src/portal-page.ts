import { brand } from "../../../src/shared/brand.ts";

export function portalPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${brand.displayName} mod portal</title>
  <style>
    :root { color-scheme: dark; --bg:#0c0d11; --card:#14161c; --line:#2a2e38; --text:#e8eaef; --muted:#9aa3b5; --accent:#c8873e; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 15px/1.45 "Noto Sans", "Liberation Sans", sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; display: grid; gap: 16px; }
    h1 { margin: 0; }
    h2 { margin: 0 0 8px; font-size: 16px; }
    p { color: var(--muted); }
    a { color: var(--accent); }
    section, .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 13px; }
    input, select, textarea { width: 100%; border: 1px solid var(--line); background: #0c0d11; color: var(--text); border-radius: 10px; padding: 8px 10px; }
    input[type="checkbox"] { width: 16px; height: 16px; padding: 0; flex: none; accent-color: var(--accent); }
    textarea { min-height: 90px; }
    button { border-radius: 10px; border: 1px solid #8c5a28; background: var(--accent); color: #1c120a; font-weight: 700; padding: 8px 12px; cursor: pointer; }
    button.ghost { background: transparent; color: var(--text); border-color: var(--line); font-weight: 500; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    label.row { align-items: center; justify-content: flex-start; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    li { border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    .err { color: #ff8d97; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header class="row" style="justify-content: space-between">
      <div><h1>${brand.displayName} mods</h1><p id="who">Checking your Twitch login…</p></div>
      <div class="row"><a id="login" href="/portal/login">Log in with Twitch</a><button class="ghost" id="export" type="button" hidden>Download config</button><button class="ghost" id="logout" type="button" hidden>Log out</button></div>
    </header>
    <p id="error" class="err"></p>
    <div id="app" hidden>
      <section>
        <h2>Commands</h2>
        <ul id="commands"></ul>
        <div class="grid">
          <label>Name <input id="c-name" /></label>
          <label>Level
            <select id="c-level"><option>everyone</option><option>sub</option><option>vip</option><option>mod</option><option>broadcaster</option></select>
          </label>
          <label>Cooldown seconds <input id="c-cool" type="number" value="5" /></label>
          <label>User cooldown <input id="c-user" type="number" value="15" /></label>
        </div>
        <label>Response <textarea id="c-response"></textarea></label>
        <button id="c-save" type="button">Save command</button>
      </section>
      <section>
        <h2>Timers</h2>
        <p>One message per line. Live and offline each have an interval. YouTube only posts while that channel is live.</p>
        <ul id="timers"></ul>
        <h2>New timer</h2>
        <div class="grid">
          <label>Name <input id="t-name" /></label>
          <label>When
            <select id="t-mode"><option value="live">Only while live</option><option value="offline">Only while offline</option><option value="both">Live and offline</option></select>
          </label>
          <label>Live interval seconds <input id="t-every" type="number" value="600" /></label>
          <label>Live min chat lines <input id="t-lines" type="number" value="5" /></label>
          <label>Offline interval seconds <input id="t-off-every" type="number" value="1800" /></label>
          <label>Offline min chat lines <input id="t-off-lines" type="number" value="5" /></label>
        </div>
        <label>Messages, one per line <textarea id="t-message"></textarea></label>
        <button id="t-save" type="button">Save timer</button>
      </section>
      <section>
        <h2>Filters</h2>
        <label class="row"><input id="f-links" type="checkbox" /> Delete messages that contain links unless permitted</label>
        <label>Blacklist, one per line: word, delete|timeout|ban, seconds
          <textarea id="f-words"></textarea>
        </label>
        <label>Whitelist, one word per line <textarea id="f-white"></textarea></label>
        <button id="f-save" type="button">Save filters</button>
      </section>
      <section>
        <h2>Mod log</h2>
        <ul id="log"></ul>
      </section>
    </div>
  </main>
  <script>
    const error = document.getElementById("error");
    async function api(path, options) {
      const response = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, options));
      if (response.status === 401) { document.getElementById("app").hidden = true; document.getElementById("who").textContent = "Log in with a Twitch account that mods this channel."; return null; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    }
    function paint(state) {
      document.getElementById("who").textContent = state.botLogin ? "Bot " + state.botLogin + " on #" + (state.channelLogin || "channel") : "Bot is not connected yet.";
      document.getElementById("app").hidden = false;
      document.getElementById("login").hidden = true;
      document.getElementById("logout").hidden = false;
      document.getElementById("export").hidden = false;
      document.getElementById("commands").innerHTML = state.commands.map((command) => "<li><strong>!" + escapeHtml(command.name) + "</strong> <span>" + escapeHtml(command.level) + " · " + command.count + "</span><p>" + escapeHtml(command.response) + "</p></li>").join("") || "<li>No commands yet.</li>";
      document.getElementById("timers").innerHTML = state.timers.map((timer) => {
        const messages = (timer.messages && timer.messages.length ? timer.messages : [timer.message]).join("\\n");
        return "<li data-id=\\"" + escapeHtml(timer.id) + "\\"><strong>" + escapeHtml(timer.name) + "</strong> <span>next: " + escapeHtml(timer.message) + "</span>"
          + "<div class=\\"grid\\"><label>Name <input class=\\"t-name\\" value=\\"" + escapeHtml(timer.name) + "\\" /></label>"
          + "<label>When <select class=\\"t-mode\\"><option value=\\"live\\"" + (timer.mode === "live" ? " selected" : "") + ">Only while live</option><option value=\\"offline\\"" + (timer.mode === "offline" ? " selected" : "") + ">Only while offline</option><option value=\\"both\\"" + (timer.mode === "both" || !timer.mode ? " selected" : "") + ">Live and offline</option></select></label>"
          + "<label>Live interval seconds <input class=\\"t-every\\" type=\\"number\\" value=\\"" + Number(timer.intervalSec) + "\\" /></label>"
          + "<label>Live min chat lines <input class=\\"t-lines\\" type=\\"number\\" value=\\"" + Number(timer.minChatLines) + "\\" /></label>"
          + "<label>Offline interval seconds <input class=\\"t-off-every\\" type=\\"number\\" value=\\"" + Number(timer.offlineIntervalSec || timer.intervalSec) + "\\" /></label>"
          + "<label>Offline min chat lines <input class=\\"t-off-lines\\" type=\\"number\\" value=\\"" + Number(timer.offlineMinChatLines || timer.minChatLines) + "\\" /></label></div>"
          + "<label>Messages, one per line <textarea class=\\"t-message\\">" + escapeHtml(messages) + "</textarea></label>"
          + "<label class=\\"row\\"><input class=\\"t-on\\" type=\\"checkbox\\"" + (timer.enabled !== false ? " checked" : "") + " /> Enabled</label>"
          + "<button class=\\"t-update\\" type=\\"button\\">Save timer</button></li>";
      }).join("") || "<li>No timers yet.</li>";
      document.getElementById("log").innerHTML = state.log.slice().reverse().map((entry) => "<li><span>" + escapeHtml(entry.action) + " " + escapeHtml(entry.user) + "</span><p>" + escapeHtml(entry.text) + "</p></li>").join("") || "<li>No actions yet.</li>";
      document.getElementById("f-links").checked = state.filters.links.enabled;
      document.getElementById("f-words").value = state.filters.blacklist.map((item) => item.word + ", " + item.action + ", " + item.timeoutSec).join("\\n");
      document.getElementById("f-white").value = state.filters.whitelist.join("\\n");
    }
    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
    }
    document.getElementById("logout").onclick = () => fetch("/portal/logout", { method: "POST" }).then(() => location.reload());
    document.getElementById("export").onclick = async () => {
      const body = await api("/portal/api/export");
      if (!body) return;
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "${brand.exportFile}";
      link.click();
    };
    document.getElementById("c-save").onclick = async () => {
      try {
        const state = await api("/portal/api/commands", { method: "POST", body: JSON.stringify({ name: document.getElementById("c-name").value, response: document.getElementById("c-response").value, level: document.getElementById("c-level").value, cooldownSec: Number(document.getElementById("c-cool").value), userCooldownSec: Number(document.getElementById("c-user").value), enabled: true }) });
        if (state) paint(state);
      } catch (err) { error.textContent = err.message; }
    };
    function timerPayload(root, id) {
      const messages = root.querySelector(id ? ".t-message" : "#t-message").value.split(/\\n/).map((line) => line.trim()).filter(Boolean);
      const mode = root.querySelector(id ? ".t-mode" : "#t-mode").value;
      return {
        id: id || undefined,
        name: root.querySelector(id ? ".t-name" : "#t-name").value,
        messages: messages,
        message: messages[0] || "",
        mode: mode,
        intervalSec: Number(root.querySelector(id ? ".t-every" : "#t-every").value),
        minChatLines: Number(root.querySelector(id ? ".t-lines" : "#t-lines").value),
        offlineIntervalSec: Number(root.querySelector(id ? ".t-off-every" : "#t-off-every").value),
        offlineMinChatLines: Number(root.querySelector(id ? ".t-off-lines" : "#t-off-lines").value),
        enabled: id ? root.querySelector(".t-on").checked : true
      };
    }
    document.getElementById("timers").onclick = async (event) => {
      const button = event.target.closest(".t-update");
      if (!button) return;
      const item = button.closest("li");
      try {
        const state = await api("/portal/api/timers", { method: "POST", body: JSON.stringify(timerPayload(item, item.getAttribute("data-id"))) });
        if (state) paint(state);
      } catch (err) { error.textContent = err.message; }
    };
    document.getElementById("t-save").onclick = async () => {
      try {
        const state = await api("/portal/api/timers", { method: "POST", body: JSON.stringify(timerPayload(document, "")) });
        if (state) paint(state);
      } catch (err) { error.textContent = err.message; }
    };
    document.getElementById("f-save").onclick = async () => {
      const blacklist = document.getElementById("f-words").value.split(/\\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [word, action, seconds] = line.split(",").map((part) => part.trim());
        return { word, action: action === "timeout" || action === "ban" ? action : "delete", timeoutSec: Number(seconds) || 60 };
      });
      const whitelist = document.getElementById("f-white").value.split(/\\n/).map((line) => line.trim()).filter(Boolean);
      try {
        const state = await api("/portal/api/filters", { method: "POST", body: JSON.stringify({ blacklist, whitelist, links: { enabled: document.getElementById("f-links").checked, action: "delete", timeoutSec: 30 }, permitSec: 60 }) });
        if (state) paint(state);
      } catch (err) { error.textContent = err.message; }
    };
    api("/portal/api/state").then((state) => { if (state) paint(state); }).catch((err) => { error.textContent = err.message; });
  </script>
</body>
</html>`;
}
