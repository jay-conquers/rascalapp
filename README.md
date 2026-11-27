# Rascal

Rascal is a free, open-source desktop app for Twitch, YouTube, and Kick. One window covers multi-platform chat and mod tools, a chat bot, channel-point alerts, and OBS browser-source overlays. The bot can also run headless on a server you control.

Kick chat arrives through a relay you run. Hosted Kick is not available yet.

## Downloads

[v0.14.5](https://github.com/jay-conquers/rascalapp/releases/tag/v0.14.5) is the first public release (pre-release).

| Platform | File |
|---|---|
| Linux x64 | [Rascal-0.14.5.AppImage](https://github.com/jay-conquers/rascalapp/releases/download/v0.14.5/Rascal-0.14.5.AppImage) |
| Windows x64 (NSIS) | [Rascal-0.14.5-win-x64.exe](https://github.com/jay-conquers/rascalapp/releases/download/v0.14.5/Rascal-0.14.5-win-x64.exe) |
| macOS Apple Silicon (arm64) | [Rascal-0.14.5-mac-arm64.dmg](https://github.com/jay-conquers/rascalapp/releases/download/v0.14.5/Rascal-0.14.5-mac-arm64.dmg) |
| Checksums | [SHA256SUMS.txt](https://github.com/jay-conquers/rascalapp/releases/download/v0.14.5/SHA256SUMS.txt) |

macOS is Apple Silicon only. An Intel Mac build is not produced.

Windows and macOS builds are unsigned. There is no certificate and no notarization.

- Windows SmartScreen can say "Windows protected your PC". Choose **More info**, then **Run anyway**.
- macOS Gatekeeper can say Apple cannot verify the developer. Control-click Rascal in Finder, choose **Open**, then **Open** again. The same approval is under System Settings → Privacy & Security → **Open Anyway**.

`SHA256SUMS.txt` is `sha256sum` form (digest, two spaces, file name). From the folder that contains the files:

```bash
sha256sum -c SHA256SUMS.txt       # Linux
shasum -a 256 -c SHA256SUMS.txt   # macOS
```

On Windows, `Get-FileHash .\Rascal-0.14.5-win-x64.exe -Algorithm SHA256` should match that file's line. Letter case does not matter.

On Linux, `chmod +x Rascal-0.14.5.AppImage` and run it. If FUSE 2 is missing, install `fuse2`, or start with `APPIMAGE_EXTRACT_AND_RUN=1`.

## Features

- **Chat and mod tools** for Twitch, YouTube, and Kick. Click or right-click a message to delete, time out, ban, or unban. A private mod log stays in Rascal. It is never posted to chat or drawn on an overlay. Viewer counts sit on each platform's status. Subs, raids, cheers, follows, and YouTube Super Chats can show in the column. Each kind has a switch and defaults to on.
- **Emotes** from Twitch, YouTube, and Kick. BetterTTV, FrankerFaceZ, and 7TV are on by default for Twitch and YouTube, each with its own switch. They are not applied to Kick.
- **Message chime** for new viewer messages, under Settings → Alerts. It stays off until you turn it on, plays while the window is in the background, and skips your own messages, the bot, duplicates, and chat history. **Output device** routes that chime only. Pick **System default** or another output, then **Refresh devices** and **Test sound**. An unplugged device falls back to the system default. Use an output OBS does not capture. TTS and redeem alerts stay on their own outputs.
- **Bot** with commands, keyword triggers, timers, filters, quotes, and a moderator portal. Built-ins include `!followage`, `!accountage`, `!so`, `!quote`, and `!cmds`. Optional thank-you lines for follows, subs, gifts, cheers, raids, and redeems stay off until you turn them on. Each command, timer, and the filter set can target Twitch, YouTube, Kick, or a combination. A command with no platform target runs on Twitch. A timer can run live, offline, or both. The bot posts as the signed-in channel or as a separate Twitch or YouTube account. Kick posts as the account you signed in with. It runs inside the app or as its own process.
- **Redeems and overlays.** Map a Twitch channel-point reward to a video, a sound, or nothing. Import a Firebot v5 `channel-rewards.json` without writing it back. Rascal only edits rewards it created. OBS browser sources serve alerts and chat, including a vertical preset.
- **Text-to-speech** panel for a local HTTP TTS service you run. Rascal does not ship that service.
- **Stream info** edits the title on every platform that is on. Twitch and Kick also edit the category. YouTube has no game field, so the game title stays in YouTube Studio. A **YouTube Studio** button beside the title opens the current livestream, the channel's livestreaming page, or Studio home. One checkbox can apply a title to every enabled platform. A failure on one platform does not stop the others.
- **Chat hooks.** A command such as `!ask` can POST the viewer's message to an address you run. See [docs/chat-hooks.md](docs/chat-hooks.md).
- **Self-hosting.** Run the headless bot with Docker, or use the optional Fly.io example. Kick uses the relay in [docs/kick-relay.md](docs/kick-relay.md).

A new install asks which platforms you use. Twitch starts checked. YouTube and Kick stay off until you select them. Turning Kick on waits until you tick **I understand**.

The top bar is Redeems, Stream info, Chat overlay, TTS, and Bot. Chat always stays. Settings is the gear and always stays. Hide a button under Settings → Tabs, or right-click it and choose Hide tab. Hiding a button does not stop the bot, the overlays, or the connections. Redeems is also hidden while Twitch is off.

## Quick setup

### Config paths

| System | Rascal files |
|---|---|
| Linux | `~/.config/rascal` (`XDG_CONFIG_HOME` is honored). Electron window data is `~/.config/Rascal`. |
| Windows | `%APPDATA%\Rascal` |
| macOS | `~/Library/Application Support/Rascal` |

On Linux and macOS, secret files are mode `0600` and their directory is mode `0700`. Windows uses the user profile ACL.

Default alert media is `~/Streaming/Rascal-Assets/Sounds` on Linux, and `Rascal-Assets/Sounds` inside Music on Windows and macOS (Documents if Music is missing). A `soundFolder` saved in `redeems.json` is left as it is.

Firebot import reads the Main profile and does not write it back. The startup import switch is under Settings → App, and only while Twitch is on. On Linux, `$XDG_CONFIG_HOME` replaces `~/.config` when it is set.

| System | Firebot v5 rewards file |
|---|---|
| Linux | `~/.config/Firebot/v5/profiles/Main/channel-rewards.json` |
| Windows | `%APPDATA%\Firebot\v5\profiles\Main\channel-rewards.json` |
| macOS | `~/Library/Application Support/Firebot/v5/profiles/Main/channel-rewards.json` |

### Twitch

Rascal is a public client and never asks for a client secret. Tokens stay in the config folder.

1. Register an application at <https://dev.twitch.tv/console/apps>. Redirect URL: `http://localhost`. Category: Application Integration. Client type: Public.
2. Paste the client ID into Settings → Advanced and choose **Save settings**.
3. Under Platforms → Twitch, choose **Log in** and approve the code at `twitch.tv/activate`.

For the moderator portal, also add `http://localhost:4788/portal/callback`. Twitch will not save a `127.0.0.1` redirect. The process listens on `127.0.0.1`.

### YouTube

Chat is read from the public live page and does not spend Data API quota. Sending, deletes, bans, and the live title use YouTube Data API v3. Rascal does not ship a Google client.

1. Enable [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. Set the OAuth consent screen to External and Testing. Add each Google account that will post or moderate as a test user. Rascal requests `https://www.googleapis.com/auth/youtube.force-ssl`.
3. Create an OAuth client. A Desktop app client accepts the loopback redirect. A Web application client needs `http://127.0.0.1:4799/youtube/callback`. Rascal listens on `127.0.0.1` and on `::1`.
4. Open **Bot → YouTube**, paste the client ID and secret, and choose **Save Google client**. They are stored in `google-client.json` (mode `0600` on Linux and macOS) and are not logged. Or set `RASCAL_GOOGLE_CLIENT_ID` and `RASCAL_GOOGLE_CLIENT_SECRET`. A set client ID overrides the file.
5. **Connect channel account**. That account is who the chat box posts as. An optional second account is the bot. It can delete and time people out only when YouTube treats it as a moderator of that live chat. The channel owner can do those without a second account. A timeout is a temporary live-chat ban. Rascal can lift a ban only when this session created it.

Check **YouTube** on the chat screen before sending there. A new install sends to Twitch only, and the checks are saved. YouTube live chat stops at 200 characters. Twitch and Kick stop at 500. When YouTube is checked, the box uses 200. Reading chat does not need the Google login.

Google's default quota is 10,000 units per day. Reading chat is free. A send is 20 units, a ban or timeout is 200, and a title save is 50 plus 1 to fetch the broadcast. The Data API chat poll stays off unless the page reader fails. The Bot tab shows the session estimate.

### Kick

Kick events are webhooks, so they need a public HTTPS address. The Docker relay, the Kick app, and the webhook URL are in [docs/kick-relay.md](docs/kick-relay.md). Without a relay address and secret, status stays **No relay configured**.

Save the relay address with **Save settings**. **Save relay secret** stores the secret only. The login includes `channel:write`, which Stream info uses for the Kick title and category. That call does not use the relay.

Once connected you can read chat, send as the signed-in account, and delete, time out, ban, or unban. A Kick timeout is 1 minute to 7 days, in whole minutes. Kick does not include channel-point redeems, a separate bot account, `!followage`, `!accountage`, `!so`, a viewer list beyond people who spoke this session, or follows, subscriptions, gifted subscriptions, and Kicks gifts in the chat column. Turning Kick off stops its connections and leaves the login saved.

### OBS overlays

Add a browser source. The pages are loopback only. Use 1920×1080, leave custom CSS empty, and turn on transparency. The port is 4777 unless you change it in Settings.

| Source | URL |
|---|---|
| Alerts | `http://127.0.0.1:4777/overlay/alerts` |
| Chat | `http://127.0.0.1:4777/overlay/chat` |
| Vertical chat | `http://127.0.0.1:4777/overlay/chat?preset=vertical` |

## Build from source

Node.js 22 and Python 3. Python's standard library rasterizes `build/icon.svg` during the build. No image library is required. The first package step needs network access so Electron can download.

```bash
npm install
npm test
npm run build:appimage
npm run build:win
npm run build:mac
```

`npm run build:appimage` writes `release/Rascal-0.14.5.AppImage` on Linux. `npm run build:win` packages the unsigned x64 NSIS installer on Windows. `npm run build:mac` packages the unsigned Apple Silicon DMG on macOS. `npm run dev` starts Vite and Electron from source. Tests do not contact Twitch, YouTube, or Kick.

After an AppImage build, `./scripts/install-local.sh` copies it to `~/Applications/Rascal.AppImage` and writes a desktop entry.

How the desk and the bot share code is in [docs/architecture.md](docs/architecture.md).

## Self-host the bot

The desktop app can keep the bot on the same computer, or control one bot on a server you run. Bring your own domain and OAuth apps. See [docs/self-hosting.md](docs/self-hosting.md).

`deploy/fly` is an optional Fly.io example: one small machine in Ashburn, app name `rascal`, volume `rascal_bot_data`. Nothing in that folder is deployed by this repository. See [deploy/fly/README.md](deploy/fly/README.md).

## License

Rascal is free software licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

Contributions are welcome through pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md).
