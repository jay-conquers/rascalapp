# Run the Rascal bot on your own server

The desktop app can keep the bot on the same computer, or it can control one bot that stays up on a server you run. This page is that second choice. Nothing here is deployed for you, and nothing here is a paid host.

The process is the same bot that can later sit behind a hosted address. You bring the domain, the Twitch application, the bot account, the Google OAuth client for YouTube, and any keys your own hook programs need. Rascal does not ship those.

## What you need

- A machine that can run Docker, with ports 80 and 443 open to the internet.
- A domain name. An A or AAAA record for `bot.example.com` points at that machine.
- A Twitch application you create in the Twitch developer console.
- A Google Cloud OAuth client if you want YouTube chat. Skip it if you only use Twitch.
- A Twitch account that will speak as the bot, and moderator status for that account in your channel.

## 1. DNS

Create `bot.example.com` and point it at the server. Wait until it resolves before you start Caddy, or the certificate request fails.

## 2. Configure

```bash
cd deploy/self-host
cp .env.example .env
chmod 600 .env
```

Edit `.env`. `PUBLIC_HOST` is the DNS name. `PUBLIC_BASE_URL` is `https://` plus that name, with no path. Generate the two secrets with `openssl rand -hex 32` and put one in `RASCAL_BOT_API_KEY` and the other in `RASCAL_BOT_SESSION_SECRET`. The API key is also the admin token you type into the desktop app.

Do not commit `.env`.

## 3. Start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f bot
```

The bot container has no published host port. It listens on the compose network. Caddy publishes 80 and 443 and proxies to `bot:4788`. Check `https://bot.example.com/healthz`. A healthy process returns `{"ok":true,"service":"rascal-bot"}`.

The container starts as root only long enough to give `/data` to the image's `node` user, then the bot listens as that user. Only Caddy is reachable from the network. Caddy still starts as root so it can bind ports 80 and 443.

## 4. Twitch application

In the Twitch developer console, create an application. The OAuth redirect URL is exactly:

```text
https://bot.example.com/portal/callback
```

`PUBLIC_BASE_URL` derives that address: the origin, then `/portal/callback`. If you also use the desktop app's own portal, add `http://localhost:4788/portal/callback` as a second redirect. Twitch will not save `127.0.0.1`.

A public client does not have a secret. Leave `RASCAL_TWITCH_CLIENT_SECRET` empty. The portal login uses PKCE, and the bot account login uses the device-code flow. Neither one sends a secret.

If the Twitch application is confidential, paste its secret into `RASCAL_TWITCH_CLIENT_SECRET` and restart the bot. The portal code exchange then includes it. Do not put the secret in git or in a log.

Put the client id in `RASCAL_BOT_CLIENT_ID`.

## 5. Google application

Create an OAuth client of type **Web application**. The authorized redirect URI is exactly:

```text
https://bot.example.com/youtube/callback
```

That is `PUBLIC_BASE_URL` plus `/youtube/callback`. Put the client id and secret in `RASCAL_GOOGLE_CLIENT_ID` and `RASCAL_GOOGLE_CLIENT_SECRET`.

The desktop app logs YouTube in on the streamer's computer at `http://127.0.0.1:4799/youtube/callback`. Add that too if you connect YouTube from the desktop. A server login uses the public redirect, and the browser must be able to open `https://bot.example.com/youtube/callback`.

## 6. Point the desktop app at the server

In Settings, open Chat & Bot, then Bot connection:

- Mode: **Server you run**
- Server URL: `https://bot.example.com`
- Admin token: the same value as `RASCAL_BOT_API_KEY`

The URL must be https. `http://localhost` is the only exception, for a server on that computer. Saving the connection does not start a second bot on the desktop.

Log the bot account in from the Bot tab. It shows a device code. Approve it as the bot account, then `/mod` that account in your channel.

## 7. Chat hooks

A hook runs inside the bot process, on the server, not on the streamer's PC.

- `http://127.0.0.1` from a hook is the bot container, not the desktop.
- A program on the streamer's computer is not reachable that way. Run it on the server, or give it an https address.
- Another container on this compose network can be called with plain http only if you set `RASCAL_HOOK_PRIVATE_HTTP=1` and use a name like `http://reader:8787/hook` or a private IP. Leave that unset unless you need it. It does not allow link-local addresses.

## 8. Backups

The bot's config, tokens, and secrets are in the `bot-data` volume, mounted at `/data`.

```bash
docker compose stop bot
docker run --rm -v self-host_bot-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/rascal-bot-data.tgz -C /data .
docker compose start bot
```

The volume name is `<compose-project>_bot-data`. `docker volume ls` shows it. Restore by stopping the bot, extracting that archive into a fresh volume, and starting again. Keep the archive off the server and off git.

## 9. Kick

Kick chat does not arrive at the bot by itself. It needs the relay in this same compose file, started with the `kick` profile. The steps, the webhook URL, and the desktop settings are in [docs/kick-relay.md](kick-relay.md).

## 10. Update and logs

```bash
git pull
docker compose up -d --build
docker compose logs --tail 100 bot
```

`docker compose logs -f bot` follows the process log. It prints the portal address and the two redirect URLs at startup. It does not print tokens or the Twitch client secret.

## Security

- `.env` is mode `600`. It holds the admin token, the session secret, and your OAuth secrets.
- Never commit `.env` or copy it into a chat, a ticket, or an image label.
- The firewall allows 22, 80, and 443. It does not allow 4788 from the internet.
- The desktop admin token is a long random string, not a Twitch password.
- Rebuild the image when you update the server. An old image keeps old code.
- `RASCAL_HOOK_PRIVATE_HTTP` stays unset unless a companion container needs plain HTTP.
