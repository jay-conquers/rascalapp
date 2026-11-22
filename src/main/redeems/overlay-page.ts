import { createHash } from "node:crypto";
import { brand } from "../../shared/brand";

export interface OverlayHello {
  type: "hello";
  service: typeof brand.healthService;
  version: string;
  overlayHash: string;
}

/** Reload when the app is serving a different overlay build than the page that is open. */
export function overlayShouldReload(bakedHash: string, message: { type?: string; overlayHash?: string }): boolean {
  return message.type === "hello" && typeof message.overlayHash === "string" && message.overlayHash.length > 0 && message.overlayHash !== bakedHash;
}

export function overlayHelloMessage(version: string, overlayHash: string): OverlayHello {
  return { type: "hello", service: brand.healthService, version, overlayHash };
}

export function bakeOverlayPage(template: string, version: string): { html: string; hash: string } {
  const hashed = template.replaceAll("__VERSION__", version).replaceAll("__HASH__", "");
  const hash = createHash("sha256").update(hashed).digest("hex").slice(0, 12);
  return { html: template.replaceAll("__VERSION__", version).replaceAll("__HASH__", hash), hash };
}

export function buildAlertsPage(version: string): { html: string; hash: string } {
  return bakeOverlayPage(pageTemplate, version);
}

const pageTemplate = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>${brand.displayName} alerts</title>
  <style>
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
    video, img { position: absolute; object-fit: contain; background: transparent; }
    audio { display: none; }
  </style>
</head>
<body>
  <script>
    const OVERLAY_HASH = "__HASH__";
    const OVERLAY_VERSION = "__VERSION__";
    const video = document.createElement("video");
    video.playsInline = true;
    video.style.objectFit = "contain";
    const image = document.createElement("img");
    image.alt = "";
    image.style.objectFit = "contain";
    const audio = document.createElement("audio");
    document.body.append(video, image, audio);
    let jobId = "";
    let cutoff = 0;
    let reloading = false;

    function hide() {
      clearTimeout(cutoff);
      video.pause();
      audio.pause();
      video.removeAttribute("src");
      audio.removeAttribute("src");
      image.removeAttribute("src");
      video.load();
      jobId = "";
    }

    function finish() {
      const id = jobId;
      hide();
      if (!id) return;
      fetch("/overlay/alerts/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id })
      }).catch(function () {});
    }

    function place(el, box) {
      el.style.position = "absolute";
      el.style.objectFit = "contain";
      el.style.margin = "0";
      el.style.maxWidth = "none";
      el.style.maxHeight = "none";
      if (!box) {
        el.style.left = "50%";
        el.style.top = "50%";
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.transform = "translate(-50%, -50%)";
        return;
      }
      el.style.transform = "none";
      el.style.left = box.left + "px";
      el.style.top = box.top + "px";
      el.style.width = box.width + "px";
      el.style.height = box.height + "px";
    }

    function reportMissingBox(job) {
      fetch("/overlay/alerts/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "alert played with no placement box",
          overlayHash: OVERLAY_HASH,
          version: OVERLAY_VERSION,
          jobId: job && job.id ? job.id : ""
        })
      }).catch(function () {});
    }

    function play(job) {
      hide();
      jobId = job.id;
      const url = "/overlay/media/" + encodeURIComponent(job.rewardId) + "?job=" + encodeURIComponent(job.id);
      const volume = Math.max(0, Math.min(1, Number(job.volume) || 0));
      const el = job.media === "audio" ? audio : job.media === "image" ? image : video;
      if (el !== audio) {
        if (!job.box) {
          place(el, null);
          reportMissingBox(job);
        } else {
          place(el, job.box);
        }
      }
      if (el !== image) {
        el.volume = volume;
        el.src = url;
        el.play().catch(function () { finish(); });
        el.onended = finish;
        el.onerror = finish;
      } else {
        image.src = url;
      }
      const limit = job.media === "image" ? (job.maxDurationMs || 5000) : job.maxDurationMs;
      if (limit) cutoff = setTimeout(finish, limit);
    }

    function connect() {
      const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/alerts");
      socket.onmessage = function (event) {
        if (reloading) return;
        let message;
        try { message = JSON.parse(event.data); } catch (err) { return; }
        if (message.type === "hello") {
          if (message.overlayHash && message.overlayHash !== OVERLAY_HASH) {
            reloading = true;
            location.reload();
            return;
          }
          socket.send(JSON.stringify({ type: "overlay-hello", version: OVERLAY_VERSION, overlayHash: OVERLAY_HASH }));
          return;
        }
        if (message.type === "alert-stop") hide();
        if (message.type === "alert-play" && message.job) play(message.job);
      };
      socket.onclose = function () { if (!reloading) setTimeout(connect, 1000); };
    }
    connect();
  </script>
</body>
</html>`;
