# Rascal

Rascal is a free, open-source streaming desk for Twitch and YouTube. It replaces the usual split between a chat client, Firebot-style channel-point alerts, and a StreamElements-style chat bot. The desktop build shipped today is a Linux AppImage, with an optional headless bot you can host yourself. The source is also set up for unsigned Windows and macOS builds.

## Features

- Combined Twitch and YouTube chat in one window, with emotes from Twitch, BetterTTV, FrankerFaceZ, and 7TV.
- Twitch login with the device-code flow. Rascal is a public client: it never asks for a client secret. Access and refresh tokens stay in the account config folder. On Linux that is `~/.config/rascal/` with mode `0600`.
- Stream title, category, and tags for the signed-in Twitch channel.
- Channel-point redeems over EventSub. Map a reward to a video, a sound, or nothing. Import a Firebot `channel-rewards.json` without writing it back. Rascal only edits rewards it created.
- On-stream chat and alert pages for OBS.
- A chat bot on its own Twitch account: commands, timers, filters, and a moderator portal. It can run inside the desktop app or as a separate process.
- A panel for a separate local text-to-speech HTTP service, if you run one. The address is a setting. Rascal does not ship that service.

A fresh install has no channel filled in. Twitch chat follows the channel in Settings, or the account you sign in with when that field is empty. YouTube chat stays off until you paste a channel ID.

## Install the AppImage

The desktop build is a Linux AppImage (x64). Releases are published separately from this repository.

```bash
chmod +x Rascal-0.5.2.AppImage
mkdir -p ~/Applications
install -m 0755 Rascal-0.5.2.AppImage ~/Applications/Rascal.AppImage
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

## Build from source

Node.js 22 and Python 3. The first build needs network access so Electron and the AppImage tool can download.

```bash
npm ci
npm test
npm run build
npx electron-builder --linux AppImage --publish never
```

`./scripts/build-appimage.sh` runs that sequence. `npm run build` rasterizes `build/icon.svg` first. The image is `release/Rascal-0.5.2.AppImage`.

Windows (NSIS, x64) and macOS (DMG, x64 and arm64) are declared in `electron-builder.yml`. They are unsigned: this repository has no certificate and no notarization settings. Those installers are built on Windows and macOS later.

```bash
npx electron-builder --win nsis --publish never
npx electron-builder --mac dmg --publish never
```

`npm run dev` starts Vite and Electron against the unpacked source. `npm test` does not contact Twitch or YouTube.

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

The bot can stay inside the desktop app, or run from `packages/bot` on a server. `deploy/fly` is a Fly.io setup for one small always-on machine in Ashburn (`shared-cpu-1x`, 256 MB, no dedicated IPv4). The app name in `fly.toml` is `rascal`. If that name is taken, use `rascalapp`. The volume is `rascal_bot_data`. The public portal callback is `https://<app-name>.fly.dev/portal/callback`.

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
