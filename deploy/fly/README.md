# Run the Rascal bot on Fly.io

This is a headless Rascal bot for one channel. One small machine stays on in Ashburn, Virginia. Nothing in this folder has been deployed. You create the Fly account and run the commands.

The machine is Fly's `shared-cpu-1x` size with 256 MB of RAM. It does not get a dedicated IPv4 address. Mods open `https://<the-app-name>.fly.dev/portal`. Rascal on the desktop talks to that same address and does not start a second bot.

Expected cost, from [Fly's pricing page](https://fly.io/pricing/):

- The machine in Ashburn (`iad`) is **$2.19 per month**. Ashburn uses the 1.0 region multiplier, so the listed `shared-cpu-1x` 256 MB price is the price you pay.
- A 1 GB volume for the bot's files is extra. Fly lists volume storage at **$0.15 per GB per month**, so this volume is about **$0.15**.
- A dedicated IPv4 is **not** included and is not used. The `*.fly.dev` hostname is HTTPS already.
- After a credit card is added, Fly's free plan includes **$5 of usage every month**. This one machine plus the 1 GB volume fits inside that $5 if they are the only Fly resources. Past $5, Fly bills the overage. Do not turn auto-stop on. A stopped machine drops the Twitch chat connection.

## 1. Install flyctl

On Arch Linux:

```bash
yay -S flyctl
fly version
```

## 2. Create the Fly account

Do this in a browser. Do not put the Fly login into the repository.

```bash
fly auth signup
```

If the account already exists:

```bash
fly auth login
```

## 3. Pick an app name

Fly app names are global. `fly.toml` uses `rascal`. If that name is already taken when you create the app, change `app` to `rascalapp` and use `https://rascalapp.fly.dev` everywhere below.

From the repository root (the folder that contains `packages/` and `deploy/`):

```bash
fly apps create rascal --config deploy/fly/fly.toml
```

`fly launch` would also create the app, but it asks questions and can deploy. Do not use it. `fly apps create` only reserves the name.

## 4. Create the volume

The volume holds `bot.json` (commands, timers, filters), `bot-tokens.json`, and `bot-secrets.json`. A redeploy keeps the volume. Deleting the volume deletes that state.

```bash
fly volume create rascal_bot_data --region iad --size 1 --app rascal
```

The name `rascal_bot_data` matches `source` in `fly.toml`. The region must be `iad`, the same region as the machine.

## 5. Set secrets

These commands read the values from the shell. They are not written into the repo. Generate the two random values once and keep them in a password manager.

```bash
openssl rand -hex 24
openssl rand -hex 24
```

The first value is the admin token. The same string is pasted into Rascal later. The second is the portal session secret.

```bash
fly secrets set --app rascal --config deploy/fly/fly.toml \
  TWITCH_CLIENT_ID="the public client id from the Twitch console" \
  RASCAL_BOT_API_KEY="the first random value" \
  RASCAL_BOT_SESSION_SECRET="the second random value" \
  RASCAL_BOT_PUBLIC_URL="https://rascal.fly.dev" \
  RASCAL_BOT_CHANNEL="yourchannel"
```

There is no Twitch client secret. The portal login is a public PKCE client. Do not set a client secret. Older `EMBER_BOT_*` names still work for one release and print a deprecation line. Use the `RASCAL_BOT_*` names.

`RASCAL_BOT_BROADCASTER_ID` is optional. The bot learns it from chat. Set it only if you already know the numeric id.

Do not put the bot's Twitch access token or refresh token in `fly secrets`. Those land on the volume in step 8.

`fly secrets set` restarts the app when it already has a machine. The first time, it only stores the values.

## 6. Deploy

Still in the repository root:

```bash
fly deploy --config deploy/fly/fly.toml --app rascal
```

Fly builds `packages/bot/Dockerfile`. The process listens on port 4788 inside the machine. Fly's proxy terminates HTTPS and forwards to that port. `auto_stop_machines` is `off`, and `min_machines_running` is 1, so the machine is not put to sleep.

Check that it answers:

```bash
curl -fsS https://rascal.fly.dev/healthz
```

The body is `{"ok":true,"service":"rascal-bot"}`.

## 7. Tell Twitch about the new redirect

On the existing Rascal Twitch application, add a second OAuth redirect URL. Leave `http://localhost` and `http://localhost:4788/portal/callback` in place.

```text
https://rascal.fly.dev/portal/callback
```

The portal itself is:

```text
https://rascal.fly.dev/portal
```

Mods log in there with Twitch. Only the broadcaster and channel mods are allowed.

## 8. Move the local bot onto the server

On Linux the local files are under `~/.config/rascal/` (`XDG_CONFIG_HOME` is honored). On Windows and macOS the upload script's default is the Rascal config folder (`%APPDATA%\Rascal` or `~/Library/Application Support/Rascal`). `--dir` still overrides that.

| File | What it is | How it moves |
|---|---|---|
| `bot.json` | Commands, timers, filters, channel | The script below |
| `bot-secrets.json` | Admin key and the StreamElements JWT | JWT only, with `--with-se`. Do not copy the local admin key. The server uses `RASCAL_BOT_API_KEY`. |
| `bot-tokens.json` | The bot account's Twitch session | Optional. Prefer a fresh login from Rascal. |
| `bot-link.json` | This computer's embedded/server choice | Stays on the desktop. Do not upload it. |

Upload the public config. This does not print the admin token or the JWT.

```bash
RASCAL_BOT_API_KEY="the first random value" \
  node deploy/fly/push-config.mjs \
  --url https://rascal.fly.dev \
  --dir ~/.config/rascal \
  --with-se
```

Drop `--with-se` if there is no StreamElements JWT.

Then connect the bot account from Rascal (next step). That runs Twitch's device-code login and stores the new session on the volume. That is the bootstrap path.

To reuse the session already on this computer instead, copy the token file once and fix its permissions. This sends the refresh token over SSH. Do not paste it into chat.

```bash
fly ssh console --app rascal
```

On the machine:

```bash
cat > /data/bot-tokens.json
chmod 600 /data/bot-tokens.json
```

Paste the contents of `~/.config/rascal/bot-tokens.json`, press Ctrl-D, then exit. Restart so the process reads the file:

```bash
fly machines restart --app rascal
```

## 9. Point Rascal at the server

Open Rascal, then Settings, then **Bot connection**.

- Mode: **Server you run**
- Server URL: `https://rascal.fly.dev`
- Admin token: the same value as `RASCAL_BOT_API_KEY`

Save. Rascal stops the bot on this computer and uses the Fly bot for the Bot tab. Connect the bot account from that tab if step 8 did not copy `bot-tokens.json`. In Twitch chat, `/mod` that bot account if it is not already a mod.

Download a backup from the Bot tab (**Download config**) or from the portal (**Download config**). The file has commands, timers, and filters. It does not contain Twitch tokens or the admin token.

```bash
curl -fsS -H "Authorization: Bearer $RASCAL_BOT_API_KEY" \
  https://rascal.fly.dev/api/export \
  -o rascal-bot-config.json
```

## 10. Roll back to the bot on this computer

In Settings, set **Bot connection** back to **Embedded on this computer** and save. Rascal starts the local bot again and stops calling Fly.

The Fly machine keeps running until it is stopped. Stopping it does not delete the volume:

```bash
fly scale count 0 --app rascal
```

Start it again later with `fly scale count 1 --app rascal`.

To undo a bad deploy but keep the data, deploy the previous image. Fly lists releases with `fly releases --app rascal`. The volume is not replaced by a new image.
