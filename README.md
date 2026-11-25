# Rascal

Rascal is a free, open-source streaming desk for Twitch and YouTube. It replaces the usual split between a chat client, Firebot-style channel-point alerts, and a StreamElements-style chat bot. The desktop build shipped today is a Linux AppImage, with an optional headless bot you can host yourself. The source is also set up for unsigned Windows and macOS builds.

## Features

- Combined Twitch and YouTube chat in one window. Twitch emotes (global, channel, subscriber, and follower) render from the emote ids in each message. YouTube member and custom emoji render from the page reader. BetterTTV, FrankerFaceZ, and 7TV global and channel emotes are on by default, each with its own switch in Settings. Settings can play a short chime for new viewer messages. It is off until you turn it on, and it keeps playing while the window is in the background.
- Twitch login with the device-code flow. Rascal is a public client: it never asks for a client secret. Access and refresh tokens stay in the account config folder. On Linux that is `~/.config/rascal/` with mode `0600`.
- Stream title, category, and tags for the signed-in Twitch channel.
- Channel-point redeems over EventSub. Map a reward to a video, a sound, or nothing. Import a Firebot `channel-rewards.json` without writing it back. Rascal only edits rewards it created.
- On-stream chat and alert pages for OBS.
- A chat bot: commands, timers, filters, quotes, and a moderator portal. A command can also fire from a keyword or phrase in a normal message. Built-ins cover `!followage`, `!accountage`, mod `!so`, `!quote`, and `!cmds`. Optional thank-you lines for follows, subs, gifts, cheers, raids, and redeems stay off until you turn them on. Each command, timer, and the filter set can target Twitch, YouTube, or both. Older items stay on Twitch. A timer can run while the stream is live, while it is offline, or both, with a separate interval for each, and it can rotate through several messages. Live and offline come from Twitch and from the YouTube page reader when that channel is live. The bot can post as the signed-in channel or as a separate account on each platform. It can run inside the desktop app or as a separate process.
- A panel for a separate local text-to-speech HTTP service, if you run one. The address is a setting. Rascal does not ship that service.
- Chat hooks. A command such as `!ask` can POST the viewer's message to an address you run. The hook is off until you enable it. A secret signs the body with `X-Rascal-Signature`. The service can stay quiet or return a short chat reply. See [docs/chat-hooks.md](docs/chat-hooks.md).

A fresh install has no channel filled in. Twitch chat follows the channel in Settings, or the account you sign in with when that field is empty. YouTube chat stays off until you paste a channel ID.

## Install the AppImage

The desktop build is a Linux AppImage (x64). Releases are published separately from this repository.

```bash
chmod +x Rascal-0.8.1.AppImage
mkdir -p ~/Applications
install -m 0755 Rascal-0.8.1.AppImage ~/Applications/Rascal.AppImage
~/Applications/Rascal.AppImage
```

If the AppImage will not start because FUSE 2 is missing:

```bash
# Arch
sudo pacman -S fuse2
# or skip FUSE
APPIMAGE_EXTRACT_AND_RUN=1 ~/Applications/Rascal.AppImage
```

From a git checkout you can also run `./scripts/install-local.sh` after a build. That copies the AppImage to `~/Applications/Rascal.AppImage` and writes `~/.local/share/applications/rascal.desktop`.

### Twitch application

1. Open <https://dev.twitch.tv/console/apps> and register an application.
2. OAuth redirect URL: `http://localhost`
3. Category: Application Integration. Client type: Public.
4. Copy the client ID into Rascal's Settings and save.
5. Choose **Log in with Twitch** and approve the code at `twitch.tv/activate`.

For the moderator portal, also add `http://localhost:4788/portal/callback`. Twitch will not save a `127.0.0.1` redirect. The process still listens on `127.0.0.1`.

### YouTube and Google OAuth

YouTube chat in the desk still arrives through the public live chat page. Sending, bot replies, deletes, and bans use the YouTube Data API v3 and a Google login. Rascal does not ship a Google client id or secret.

1. Open [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) and enable it on a Google Cloud project you control.
2. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Configure the OAuth consent screen as External and Testing. Add every Google account that will post or moderate as a test user. The scope Rascal requests is `https://www.googleapis.com/auth/youtube.force-ssl` (the consent screen shows it as managing the YouTube account). That scope is what live chat send, delete, and ban require.
3. Create an OAuth client.
   - **Desktop app.** Rascal sends the browser to Google and listens on `http://127.0.0.1:4799/youtube/callback`. Desktop clients accept that loopback redirect.
   - **Web application.** Add this exact redirect URI: `http://127.0.0.1:4799/youtube/callback`.
4. In Rascal, open **Bot → YouTube**, paste the client ID and client secret, and choose **Save Google client**. They are written to `google-client.json` next to the other config files, mode `0600` on Linux and macOS. They are not logged and they are not in git.
5. Or set `RASCAL_GOOGLE_CLIENT_ID` and `RASCAL_GOOGLE_CLIENT_SECRET` in the environment. When the client ID variable is set, it overrides the file. Do not commit those values.
6. **Connect channel account** and approve the prompt in the browser. That is the account the chat box posts as. Use the Google account that owns the YouTube channel, or another account you want the typed messages to come from.
7. Optional: **Connect bot account** with a second Google account. Leave **Post as the signed-in channel** unchecked if the bot should use that second account. Check it if the bot should post as the channel account from step 6. Twitch keeps using its separate bot account unless you check the same box on the Twitch section.
8. A separate bot account can delete messages and time people out only when YouTube considers it a moderator of that live chat. The channel owner can do those actions without a second account. YouTube has no timeout call of its own: a timeout is a temporary live-chat ban, and a ban is a permanent one. Rascal can lift a ban only when this session created it, because the API deletes a ban by the ban id and does not list bans.
9. On each command and timer, check Twitch, YouTube, or both. The filter card has the same checks. Anything saved before this version stays on Twitch.
10. On the chat screen, check **YouTube** before sending. That choice is saved, including across tabs and restarts. A new install sends to Twitch only. If YouTube is offline, or sending is not set up yet, the box stays as you left it and shows a short note. Messages skip YouTube until live chat is available, then include it again with no re-check. Reading chat does not need the Google login. YouTube live chat stops at 200 characters. Twitch still stops at 500. Checking both sends to both when each one can take a message. Twitch chat still works while the stream is offline. A send uses the active live chat for the video Rascal is reading. An upcoming or finished broadcast is not used, even when YouTube still lists a chat id for it. If YouTube rejects a message, the error text is YouTube's own reason.

Incoming YouTube chat, for the desk and for the bot, comes from the public live chat page (`youtubei` `get_live_chat`). That does not spend Data API quota. The message id and the author channel id from that page are the ones delete and ban use. The Data API is used when someone sends, deletes, times out, or bans, and once to learn the `liveChatId`. A checkbox on the Bot tab can also poll `liveChatMessages.list`. It is off unless the page reader fails three times in a row, and it turns off again when the page reader recovers.

The page asks Rascal to wait, often about 5 seconds, before the next chat fetch. Rascal asks about every 1.5 seconds instead (never faster than 1 second). `RASCAL_YOUTUBE_POLL_MS` changes that target. A 429 or another error stretches the wait toward YouTube's suggested timeout, and healthy polls ease it back down. Repeated copies of the same message id are dropped. The Data API poll, when it is on, still waits for `pollingIntervalMillis` and does not use this 1.5 second pace.

The bot finds `liveChatId` with `liveBroadcasts.list` (`mine=true`, active) when it needs to post or moderate. A moderator account does not own the broadcast, so that call can come back empty. Rascal then uses the video id the page reader already has, and `videos.list` `liveStreamingDetails.activeLiveChatId`.

#### Quota

Google's default project quota is **10,000 units per day** and it resets at midnight Pacific time. Costs below are from [Google's quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) as published in November 2026. The numbers in Rascal live in `src/shared/platform/youtube-quota.ts`.

| Call | Units |
|---|---|
| `liveChatMessages.list` (one Data API poll) | 5 |
| `liveChatMessages.insert` (one sent message) | 20 |
| `liveChatMessages.delete` | 20 |
| `liveChatBans.insert` (timeout or ban) | 200 |
| `liveChatBans.delete` (lift a ban) | 200 |
| `liveBroadcasts.list`, `videos.list`, `channels.list` | 1 each |

A normal 5-hour stream does not poll `liveChatMessages.list`. Reading chat is free. One lookup for the live chat id is 1 unit. Each bot reply or typed send is 20. Thirty replies in those 5 hours is about **601 units** (1 + 30 × 20). The same 5 hours polled on the Data API every 5 seconds is 3,600 polls × 5 = **18,000 units** before replies, or about **18,601** once those 30 replies are included. That is more than the daily quota. The Data API poll stays off.

If the whole 10,000 units were spent on one kind of call, that would be 2,000 polls, 500 sent messages, 500 deletes, or 50 bans. The Bot tab shows the session estimate and the 5-hour figure.

## Build from source

Node.js 22 and Python 3. The first build needs network access so Electron and the AppImage tool can download.

```bash
npm ci
npm test
npm run build
npx electron-builder --linux AppImage --publish never
```

`./scripts/build-appimage.sh` runs that sequence. `npm run build` rasterizes `build/icon.svg` first. The image is `release/Rascal-0.8.1.AppImage`.

Windows (NSIS, x64) and macOS (DMG, x64 and arm64) are declared in `electron-builder.yml`. They are unsigned: this repository has no certificate and no notarization settings. Those installers are built on Windows and macOS later.

```bash
npx electron-builder --win nsis --publish never
npx electron-builder --mac dmg --publish never
```

`npm run dev` starts Vite and Electron against the unpacked source. `npm test` does not contact Twitch or YouTube.

## Chat notices, viewers, and the mod log

The chat column shows Twitch subs, resubs, gifted subs, raids, and cheers when chat sends them. Cheers are the bits messages already in IRC. Follows, watch streaks, and mod anniversaries come from EventSub (`channel.follow` v2 and `channel.chat.notification`). YouTube Super Chats, Super Stickers, memberships, gifted memberships, and member milestones come from the page reader. Channel point redeems show the reward name, who redeemed it, and any text they typed. Each of those, and the private mod log, has a switch in Settings. They default to on.

A login from 0.7.0 does not include the new scopes. Rascal keeps reading chat. Settings names the missing scopes and asks you to log in again. Approve the device code when you want the mod log, follows, watch streaks, and mod anniversaries. The scopes added in 0.8.0 are `user:read:chat`, `moderator:read:followers`, and the moderator read set required by `channel.moderate` v2: `moderator:read:blocked_terms`, `moderator:read:chat_settings`, `moderator:read:unban_requests`, `moderator:read:banned_users`, `moderator:read:chat_messages`, `moderator:read:warnings`, `moderator:read:moderators`, and `moderator:read:vips`. `channel:read:redemptions` was already requested.

The mod log is a panel in Rascal's own window. It lists Twitch timeouts, bans, unbans, message deletes, warnings, chat clears, chat mode changes, and mod or unmod, with who did it and the duration or reason when Twitch sent them. It is not posted to Twitch or YouTube chat, and it is not drawn on the alert or chat overlay. YouTube's page reader reports deleted messages and removed authors, and ban or timeout banners when the text says so. It usually does not name the moderator, and a removed author is not labeled as a ban unless the banner says banned.

Viewer counts sit on the Twitch and YouTube status pills. Twitch uses Helix `GET /streams` about every 60 seconds and needs a login. YouTube uses the concurrent count on the live page (`videoDetails.viewCount` while the player says the broadcast is live). That does not call `videos.list`.

Emote images are cached on disk under the config directory after a fetch that sends no cookies and no auth header. Only https images on the Twitch, BetterTTV, FrankerFaceZ, 7TV, and YouTube hosts Rascal already allows are stored. SVG is not stored.

Twitch's public `channel.chat.notification` list includes `watch_streak` and `modiversary` (plus `shared_chat_modiversary`). It does not list a separate `shared_chat_watch_streak` type. A watch streak that arrives as `watch_streak` with a source channel name is labeled as shared chat. VIP changes, AutoMod term edits, and unban-request decisions are not shown.

## OBS overlays

Add a browser source. Both pages are loopback only.

| Source | URL |
|---|---|
| Alerts | `http://127.0.0.1:4777/overlay/alerts` |
| Chat | `http://127.0.0.1:4777/overlay/chat` |
| Vertical chat | `http://127.0.0.1:4777/overlay/chat?preset=vertical` |

Use 1920×1080, leave custom CSS empty, and turn on transparency. The page reloads itself when a newer Rascal build changes the overlay. Refresh the browser source once if it was left open from a build that did not have that check.

The port is 4777 unless you change it in Settings. The paths stay the same.

## Self-host the bot

The bot can stay inside the desktop app, or run on a server you control. The step-by-step for your own domain, HTTPS, and OAuth apps is [docs/self-hosting.md](docs/self-hosting.md). `deploy/fly` is an optional Fly.io example for one small always-on machine in Ashburn (`shared-cpu-1x`, 256 MB, no dedicated IPv4). The app name in `fly.toml` is `rascal`. If that name is taken, use `rascalapp`. The volume is `rascal_bot_data`. The public portal callback is `https://<your-host>/portal/callback`.

Nothing in `deploy/fly` is deployed by this repository. The steps, the cost notes, and the secret commands are in [deploy/fly/README.md](deploy/fly/README.md). Put tokens in `fly secrets` or in the volume, not in git.

## Configuration

On Linux, settings, tokens, redeem mappings, and the bot files live in `~/.config/rascal` (`XDG_CONFIG_HOME` is honored). Electron's own window data stays in `~/.config/Rascal`. The first launch copies `~/.config/ember` into `~/.config/rascal` when that folder is missing, and `~/.config/Ember` into `~/.config/Rascal`, and leaves the old folders in place.

On Windows those files live in `%APPDATA%\Rascal`. On macOS they live in `~/Library/Application Support/Rascal`.

Secret files are mode `0600` on Linux and macOS, and their directory is mode `0700`. Windows has no Unix permission bits. Rascal does not call chmod there, so startup does not crash, and access control is the user profile ACL.

The default alert media folder is `~/Streaming/Rascal-Assets/Sounds` on Linux. On Windows and macOS it is `Rascal-Assets/Sounds` inside Music (Documents if Music is not available). A `soundFolder` already saved in `redeems.json` is left as it is.

The log records that a config copy happened and does not include file contents.

## License

Rascal is free software licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

Contributions are welcome through pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md).
