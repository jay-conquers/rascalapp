import { brand } from "../../shared/brand";
import { bakeOverlayPage } from "../redeems/overlay-page";

/** Transparent OBS page. Filtering happens in the app; this page only paints frames. */
export function buildChatOverlayPage(version: string): { html: string; hash: string } {
  return bakeOverlayPage(pageTemplate, version);
}

const pageTemplate = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>${brand.displayName} chat</title>
  <style>
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
    body { position: relative; }
    #log {
      position: absolute;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 8px 10px;
      overflow: hidden;
      background: transparent;
    }
    .row { display: flex; flex: 0 0 auto; gap: 8px; align-items: flex-start; max-width: 100%; margin: 3px 0; padding: 4px 10px; border-radius: 12px; line-height: 1.25; justify-content: flex-start; }
    .body { min-width: 0; text-align: left; }
    .name { font-weight: 700; margin-right: 6px; }
    .badges { display: inline-flex; gap: 3px; margin-right: 6px; vertical-align: middle; }
    .badge { height: 1.15em; width: auto; vertical-align: middle; }
    .amount { font-size: 0.72em; font-weight: 800; background: #f0c14d; color: #2a1d04; border-radius: 999px; padding: 0 6px; margin-right: 6px; }
    .notice { display: block; opacity: 0.8; font-size: 0.72em; margin-bottom: 2px; }
    .emote { height: 1.5em; vertical-align: middle; }
    .action { font-style: italic; }
    .platform { width: 1em; height: 1em; flex: none; margin-top: 0.2em; }
  </style>
</head>
<body>
  <div id="log"></div>
  <script>
    const OVERLAY_HASH = "__HASH__";
    const OVERLAY_VERSION = "__VERSION__";
    const PRESET = new URLSearchParams(location.search).get("preset") || "default";
    let reloading = false;

    function hexToRgba(hex, opacity) {
      const color = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000";
      const red = parseInt(color.slice(1, 3), 16);
      const green = parseInt(color.slice(3, 5), 16);
      const blue = parseInt(color.slice(5, 7), 16);
      return "rgba(" + red + ", " + green + ", " + blue + ", " + opacity + ")";
    }

    function applyStyle(style, box) {
      const log = document.getElementById("log");
      const family = style.fontFamily && style.fontFamily.indexOf("sans-serif") === -1 ? style.fontFamily + ", sans-serif" : style.fontFamily;
      const rect = box && box.width ? box : { left: 0, top: 0, width: 1920, height: 1080 };
      log.style.fontFamily = family || "sans-serif";
      log.style.fontSize = style.fontSize + "px";
      log.style.color = style.textColor;
      log.style.left = rect.left + "px";
      log.style.top = rect.top + "px";
      log.style.width = rect.width + "px";
      log.style.height = rect.height + "px";
      log.style.margin = "0";
      log.style.textAlign = "left";
      log.style.alignItems = "stretch";
      log.style.justifyContent = style.direction === "bottom" ? "flex-end" : "flex-start";
      log.style.overflow = "hidden";
      const shadow = [];
      if (style.outline) shadow.push("1px 1px 0 #000", "-1px 1px 0 #000", "1px -1px 0 #000", "-1px -1px 0 #000");
      if (style.shadow) shadow.push("0 2px 4px rgba(0,0,0,.85)");
      log.style.textShadow = shadow.join(", ") || "none";
    }

    function icon(platform) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("class", "platform");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      if (platform === "youtube") {
        svg.setAttribute("fill", "#ff4d4d");
        path.setAttribute("d", "M21.2 7.4a2.7 2.7 0 0 0-1.9-1.9C17.6 5 12 5 12 5s-5.6 0-7.3.5a2.7 2.7 0 0 0-1.9 1.9C2.3 9.1 2.3 12 2.3 12s0 2.9.5 4.6a2.7 2.7 0 0 0 1.9 1.9C6.4 19 12 19 12 19s5.6 0 7.3-.5a2.7 2.7 0 0 0 1.9-1.9c.5-1.7.5-4.6.5-4.6s0-2.9-.5-4.6zM10.2 15.1V8.9L15.6 12l-5.4 3.1z");
      } else {
        svg.setAttribute("fill", "#bf94ff");
        path.setAttribute("d", "M5 3h15v10.2l-4.2 4.2H12L9.2 20H7.2v-2.6H3V6.2L5 3zm2.1 2.1v10.4h3.2V18l2.6-2.5h3.6l2.4-2.4V5.1H7.1zm8.2 2.2h1.6v4.6h-1.6V7.3zm-4.2 0h1.6v4.6h-1.6V7.3z");
      }
      svg.append(path);
      return svg;
    }

    function safeOverlayImage(url) {
      if (typeof url !== "string") return false;
      try {
        var parsed = new URL(url);
      } catch (err) {
        return false;
      }
      if (parsed.protocol === "https:") {
        var allowed = {
          "static-cdn.jtvnw.net": 1,
          "cdn.betterttv.net": 1,
          "cdn.frankerfacez.com": 1,
          "cdn.7tv.app": 1,
          "yt3.ggpht.com": 1,
          "yt3.googleusercontent.com": 1,
          "i.ytimg.com": 1,
          "lh3.googleusercontent.com": 1
        };
        return allowed[parsed.hostname] === 1 && !parsed.username;
      }
      if (parsed.protocol !== "http:") return false;
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return false;
      var hash = parsed.pathname.slice("/emote/".length);
      return parsed.pathname === "/emote/" + hash && /^[a-f0-9]{64}$/.test(hash);
    }

    function lineEl(line, style) {
      const row = document.createElement("div");
      row.className = "row";
      row.style.opacity = String(line.opacity == null ? 1 : line.opacity);
      row.style.justifyContent = "flex-start";
      row.style.background = style.background === "pill" ? hexToRgba(style.backgroundColor, style.backgroundOpacity) : "transparent";
      if (style.showPlatformIcons) row.append(icon(line.platform));
      const body = document.createElement("div");
      body.className = "body";
      if (line.notice) {
        const notice = document.createElement("span");
        notice.className = "notice";
        notice.textContent = line.notice;
        body.append(notice);
      }
      if (line.name) {
        const name = document.createElement("span");
        name.className = "name";
        name.style.color = line.nameColor || style.nameColor;
        name.textContent = line.name;
        body.append(name);
      }
      if (line.badges && line.badges.length) {
        const badges = document.createElement("span");
        badges.className = "badges";
        for (const badge of line.badges) {
          if (!badge.url || !safeOverlayImage(badge.url)) continue;
          const image = document.createElement("img");
          image.className = "badge";
          image.alt = "";
          image.src = badge.url;
          image.addEventListener("error", function () { image.remove(); });
          badges.append(image);
        }
        if (badges.childNodes.length) body.append(badges);
      }
      if (line.amount) {
        const amount = document.createElement("span");
        amount.className = "amount";
        amount.textContent = line.amount;
        body.append(amount);
      }
      const text = document.createElement("span");
      if (line.action) text.className = "action";
      for (const part of line.parts || []) {
        if (part.type === "emote" && safeOverlayImage(part.url)) {
          const image = document.createElement("img");
          image.className = "emote";
          image.alt = part.text || "";
          image.src = part.url;
          image.addEventListener("error", function () {
            image.replaceWith(document.createTextNode(part.text || ""));
          });
          text.append(image);
        } else {
          text.append(document.createTextNode(part.text || ""));
        }
      }
      body.append(text);
      row.append(body);
      return row;
    }

    function render(frame) {
      if (!frame || !frame.style || !Array.isArray(frame.lines)) return;
      applyStyle(frame.style, frame.box);
      const log = document.getElementById("log");
      const nodes = document.createDocumentFragment();
      for (const line of frame.lines) nodes.append(lineEl(line, frame.style));
      log.replaceChildren(nodes);
      log.scrollTop = frame.style.direction === "down" ? log.scrollHeight : 0;
    }

    function connect() {
      const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/overlay-chat?preset=" + encodeURIComponent(PRESET));
      socket.onmessage = function (event) {
        if (reloading) return;
        let message;
        try { message = JSON.parse(event.data); } catch (err) { return; }
        if (message.type === "hello") {
          if (message.overlayHash && message.overlayHash !== OVERLAY_HASH) {
            reloading = true;
            location.reload();
          }
          return;
        }
        if (message.type === "chat-frame") render(message);
      };
      socket.onclose = function () { if (!reloading) setTimeout(connect, 1000); };
    }
    connect();
  </script>
</body>
</html>`;
