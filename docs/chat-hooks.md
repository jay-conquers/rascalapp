# Chat hooks

A chat hook sends a viewer's command to an address you run. Rascal does not include a text-to-speech program or a chatbot. The hook only delivers the message and, if you ask it to, posts a short reply.

Hooks are stored in `bot.json` under `hooks`. A new hook is off until you enable it. Open the Bot tab, fill in the form, save, then press Test. Test sends a sample payload and shows the HTTP status and how long the call took.

## What Rascal sends

`POST` with `Content-Type: application/json`.

```json
{
  "hook": "reader",
  "platform": "twitch",
  "channel": "mychannel",
  "user": { "id": "7", "login": "viewer", "displayName": "Viewer", "roles": ["everyone"] },
  "message": "!ask what time is it",
  "text": "what time is it",
  "timestamp": 1760000000000,
  "messageId": "abc"
}
```

`message` is the full chat line. `text` is the part after the command, or the part after a keyword. `platform` is `youtube` when the line came from YouTube, and `twitch` otherwise. A Kick line is labeled `twitch`, because that field has no Kick value. A hook saved from the Bot tab is stored with `platforms` set to `all`, so it can still fire on Kick.

If the hook has a secret, Rascal adds `X-Rascal-Signature: sha256=<hex>`. The hex is HMAC-SHA256 of the raw body, using the secret as the key. Compare it with a constant-time check. A hook with no secret is not signed.

When Reply is "Post the service reply in chat", a JSON body `{"reply": "hello"}` or a plain text body is posted, cut off at 450 characters. `reply` mode `none` does not post anything. Errors stay out of chat and show in the bot log as the hook name and a short reason. The log does not include the secret or the query string of the address.

Use `https://` for a service on another computer. `http://` is only accepted for `localhost`, `127.0.0.1`, or `[::1]`. Set `RASCAL_HOOK_PRIVATE_HTTP=1` to also allow `http://` to an RFC1918 address or a single-label name such as another container. Link-local addresses, cloud metadata, and decimal, octal, or hex IP spellings stay blocked. Before connecting, Rascal resolves the name and refuses the call if any address is not allowed for that URL, then connects to the address it checked. Redirects are not followed.

Rascal skips the streamer's own messages unless that hook sets `allowBroadcaster` to true. The bot account's messages, a duplicate of a message it already saw, and chat history older than about 12 seconds are always skipped. A line Rascal itself just posted is skipped too, including when the bot posts as the streamer's account, so a reply cannot call the hook again. The command cooldown and the per-viewer cooldown are the ones on the hook.

```json
{ "name": "reader", "trigger": "ask", "url": "http://127.0.0.1:8787/", "allowBroadcaster": true }
```

## Example receiver

```js
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const secret = process.env.HOOK_SECRET ?? "";
createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    if (secret) {
      const expect = createHash("sha256").update("sha256=" + createHmac("sha256", secret).update(raw).digest("hex")).digest();
      const got = createHash("sha256").update(String(req.headers["x-rascal-signature"] ?? "")).digest();
      if (!timingSafeEqual(got, expect)) {
        res.writeHead(401).end();
        return;
      }
    }
    const body = JSON.parse(raw.toString("utf8"));
    console.log(`${body.user.displayName}: ${body.text}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ reply: `heard ${body.text}` }));
  });
}).listen(8787, "127.0.0.1");
```

Point the hook at `http://127.0.0.1:8787/` and set the same secret.
