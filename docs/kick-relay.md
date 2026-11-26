# Kick relay

Kick's public API does not offer a chat socket. Chat and channel events arrive as webhooks, and a webhook needs a public HTTPS address. A desktop install on its own cannot receive them.

Rascal therefore talks to Kick through a small relay. You run that relay, or you wait for Rascal hosting, which is not available yet. The same relay process is what a hosted tier would run later. The desktop app connects out to it. It does not open a public port of its own.

Without a relay, Kick chat and events do not arrive. Settings says **No relay configured** until both the address and the secret are saved.

## What you need

- A machine with a public HTTPS name. Docker is enough.
- A Kick developer app that you create. Rascal does not ship a client id or secret.
- A long random string used only between Rascal and the relay. `openssl rand -hex 32` is a good one.

Do not commit the secret, the client secret, or a token. Do not put the secret in the relay address.

## 1. Run the relay

From a git checkout, in `deploy/self-host`:

```bash
cp .env.example .env
chmod 600 .env
```

Set `RELAY_SECRET` in `.env` to the random string. Then:

```bash
docker compose --profile kick up -d --build relay
```

The relay listens on port 8790 inside the compose network. Caddy publishes HTTPS and forwards two paths to it:

| Path | Who calls it |
|---|---|
| `https://<your-host>/webhooks/kick` | Kick |
| `wss://<your-host>/v1/events` | Rascal |

`https://<your-host>/healthz` is still the bot. The relay's own check is `http://127.0.0.1:8790/healthz` inside the container and returns `{"ok":true,"service":"relay"}`.

The image can also be built on its own:

```bash
docker build --file packages/relay/Dockerfile --tag rascal-relay .
docker run --rm -p 8790:8790 -e RELAY_SECRET='your-long-random-string' rascal-relay
```

Put TLS in front of that port before anything but your own computer connects. Rascal sends the secret on the socket. It allows `ws://` only for `localhost` and `127.0.0.1`. Any other host must be `wss://`.

The relay downloads Kick's public key from `https://api.kick.com/public/v1/public-key` and refreshes it. Leave that alone. Do not paste a key into the environment. Kick rotates the key, and a saved copy will start rejecting real events.

`RELAY_PORT` defaults to 8790. `RELAY_BIND` defaults to `0.0.0.0` in the image.

## 2. Create the Kick app

Open [Kick developer settings](https://kick.com/settings/developer) and create an app.

- Redirect URL: `http://localhost:4801/kick/callback`
- Turn webhooks on.
- Webhook URL: `https://<your-host>/webhooks/kick`

Kick will not deliver webhooks to `localhost`. The redirect above is only for the login on the computer where Rascal is open. The process listens on `127.0.0.1:4801`. The redirect host is `localhost` because Kick rewrites `127.0.0.1` to that name.

Copy the client ID and the client secret into Rascal. They are stored in `kick-client.json` next to the other config files, mode `0600` on Linux and macOS. They are not written to `settings.json` and they are not logged.

## 3. Connect Rascal

Turn Kick on in the platform list. The notice explains that Kick needs hosting or this relay. Tick **I understand**, then continue. Cancel leaves Kick off. Rascal remembers the acknowledgement. Turning Kick off and on again does not ask a second time. Deleting `settings.json` clears it, and the notice comes back.

In Settings, with Kick on:

1. Relay address: `wss://<your-host>/v1/events`
2. Relay secret: the same string as `RELAY_SECRET`. Choose **Save relay secret**.
3. Under Advanced, Kick client ID and client secret. Choose **Save Kick app**.
4. Under Kick, choose **Log in** and approve the app.

The login asks for `user:read`, `channel:read`, `channel:write`, `chat:write`, `events:subscribe`, `moderation:ban`, and `moderation:chat_message:manage`. After that, Rascal subscribes to `chat.message.sent`, `livestream.status.updated`, and `moderation.banned`. Kick posts those to the webhook URL on the app. The relay checks the signature and forwards the event to Rascal.

Stream title and category use `PATCH /public/v1/channels` (`stream_title` and `category_id`). That is a normal API call. It does not use the relay, so it works when the relay address is empty. `channel:write` is what that call needs. A login from before that scope was requested can still read and moderate chat. Stream info says to log in again before the title can be saved. Category search uses `GET /public/v2/categories`.

The address is saved in `settings.json` as `kickRelayUrl`. The secret is saved in `kick-relay.json`. The login is saved in `kick-tokens.json`.

If the address or the secret is missing, Kick's status stays **No relay configured**. Rascal does not open a socket and does not pretend that chat is connected.

## 4. What works

- Reading chat, once the relay is connected.
- Sending a chat message from the chat box, as the account you signed in.
- Deleting a message, timing a viewer out, banning, and unbanning, from the moderation menu. A timeout is sent to Kick in whole minutes, from 1 minute through 7 days. Anything shorter is rounded up. The broadcaster is left alone.
- A live or offline flag from `livestream.status.updated`, so a timer can follow the channel.
- Commands, timers, and filters that target Kick, or that target every platform. An older item saved for Twitch or YouTube stays there. An item saved as every platform also runs on Kick after Kick is on.
- Emotes that arrive inside a Kick chat event. Their images come from `files.kick.com`.

Turning Kick off closes the relay socket and stops Kick API calls. The login, the client, and the relay secret stay on disk. Turning it back on uses them again.

An install from 0.11.0 or earlier does not turn Kick on. Kick is added only after the notice is accepted.

A bot that has no saved platform list still connects Twitch and YouTube only. Kick is not part of that default.

## What Kick does not do here

- Rascal hosting. It is not built. The relay above is the way to receive Kick events until then.
- Chat or events with no relay.
- A second Kick account for the bot. Messages are sent as the signed-in user.
- Channel-point redeems in the Redeems panel.
- `!followage`, `!accountage`, and `!so`. Kick's API does not provide those the way Twitch does.
- A viewer list for `@` mentions. Kick suggests people who have spoken in this session.
- BetterTTV, FrankerFaceZ, and 7TV on Kick messages.
- Follows, subscriptions, gifted subscriptions, Kicks gifts, and channel-reward redemptions. Those events are not subscribed to and are not shown.
- Stream keys, ads, and the Kicks leaderboard.

## A note for a later hosted tier

The relay is not tied to one streamer's desktop. It checks Kick's signature, then fans the event out to any client that presents the shared secret on the socket. A hosted Rascal would run this same image and connect the same way. Nothing in the relay stores a Kick token.
