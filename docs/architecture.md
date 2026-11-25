# Architecture

Rascal is two programs that share one chat model.

The **desk** is the Electron app. It reads chat, shows the window, and serves the OBS overlay. The **bot** is a plain Node service. It can run inside the desk or on its own (Docker, `packages/bot`). Commands, timers, filters, quotes, and hooks live in the bot. The desk talks to a bot that is in-process or to one you host, over the same HTTP API.

```
src/main        Electron main process: window, IPC, chat sockets, overlay server
src/preload     the narrow bridge the window is allowed to call
src/renderer    the React window
src/shared      code both the desk and the bot may import
packages/bot    the headless bot: config, command engine, HTTP API, portal
```

`packages/bot` does not import `src/main`, `src/renderer`, or Electron. `src/shared` does not import those at runtime either. The window does not import Electron or the main process. `tests/architecture.test.ts` keeps those three rules. A type-only import of the bot snapshot into `src/shared/api.ts` is the IPC contract and stays a type.

## Chat platforms

A platform is a `ChatPlatform` (`src/shared/platform/types.ts`): connect, send, delete, timeout, ban, unban, look up a user, and report whether the channel is live. Incoming chat is a `NormalizedChatMessage`. Twitch and YouTube each have an adapter in `packages/bot/src/platform/`. The desk has its own readers (Twitch IRC and EventSub, the YouTube page reader in `src/shared/youtube/page-reader.ts`) and hands the bot a line that is already in that shape.

`BotService` constructs a Twitch adapter and a YouTube adapter and registers both on `PlatformRegistry`. Chat, timers, moderation, login, and the snapshot walk that list. The adapters implement `BotPlatform` in `src/shared/platform/bot-platform.ts`. Commands and filters ask `targetsPlatform` for the saved target string.

### Adding a platform

1. Implement `ChatPlatform` for the new site. Keep tokens and HTTP in the adapter. Do not log a token, a client secret, or a URL that still has its query string.
2. Register it next to the Twitch and YouTube adapters in the `BotService` constructor. Snapshot cards, timers, and chat already walk the registry.
3. Extend `PlatformTarget` in `src/shared/platform/target.ts`. Today it is the string `"twitch"`, `"youtube"`, or `"all"`, and an unknown value loads as `"twitch"`. Adding a third site changes `bot.json`. Ship that with `normalizeBotFile` and a golden file under `tests/fixtures/config/` so an existing config still loads.
4. Add the checkbox in the bot window. `targetFromChecks` and `checksFromTarget` are the two-site version of that mapping.
5. If the desk should show the chat, add a reader that emits `NormalizedChatMessage` and a send path. The bot adapter and the desk reader can share the protocol code in `src/shared`.

Kick is the next planned site. Rumble and TikTok can follow the same steps. Nothing in this tree speaks to them yet.

## Bot config and engine

`packages/bot/src/config.ts` loads and normalizes `bot.json`: commands, timers, filters, quotes, hooks, thanks, and shoutouts. `packages/bot/src/engine.ts` decides what one chat line does and when a timer is due. `packages/bot/src/model.ts` re-exports both, so existing imports keep working. `bot.json` from 0.5.0 and 0.8.1 loads unchanged. The golden files in `tests/fixtures/config/` are that contract.

## Saved files

The desk and the bot share one config directory (`~/.config/rascal` on Linux). Secret files are mode `0600`. The bot's own API key, Twitch tokens, and YouTube tokens are separate files from `settings.json`. See the README for paths on Windows and macOS.
