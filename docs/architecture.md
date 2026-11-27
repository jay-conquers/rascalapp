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

A platform is a `ChatPlatform` (`src/shared/platform/types.ts`): connect, send, delete, timeout, ban, unban, look up a user, and report whether the channel is live. Incoming chat is a `NormalizedChatMessage`. Twitch, YouTube, and Kick each have an adapter in `packages/bot/src/platform/`. `PlatformRegistry` lives in `src/shared/platform/registry.ts`. The desk's `DeskPlatform` shape is `src/shared/platform/desk.ts`. The desk registers Twitch, YouTube, and Kick in `src/main/runtime-core.ts`. Starting the app and sending a chat line walk that list. Twitch IRC, EventSub, and the YouTube page reader stay behind those adapters. The page reader lives in `src/shared/youtube/page-reader.ts`. Kick chat is not a socket on Kick's side. A relay (`packages/relay`) checks Kick's webhook signature and forwards the event. The desktop and the bot both connect out to that relay. See [kick-relay.md](kick-relay.md).

`BotService` extends `BotChat`, which extends `BotEditing`, which extends `BotState`. The `BotState` constructor registers a Twitch adapter, a YouTube adapter, and a Kick adapter on `PlatformRegistry`. Chat, timers, moderation, login, and the snapshot walk that list. The adapters implement `BotPlatform` (`src/shared/platform/bot-platform.ts`), which extends `ChatPlatform`. Commands and filters ask `targetsPlatform` for the saved target string.

### Adding a platform

1. Implement `ChatPlatform` for the new site. Keep tokens and HTTP in the adapter. Do not log a token, a client secret, or a URL that still has its query string.
2. Register it next to the Twitch, YouTube, and Kick adapters in the `BotState` constructor. Snapshot cards, timers, and chat already walk the registry.
3. Extend `PlatformTarget` in `src/shared/platform/target.ts`. Today a saved target is `"twitch"`, `"youtube"`, `"kick"`, `"all"`, or a pair such as `"twitch+kick"`. An unknown value loads as `"twitch"`. Adding another site changes `bot.json`. Ship that with `normalizeBotFile` and a golden file under `tests/fixtures/config/` so an existing config still loads.
4. Add the checkbox in the bot window. `targetFromChecks` and `checksFromTarget` map the Twitch, YouTube, and Kick checks onto that stored string.
5. If the desk should show the chat, add a reader that emits `NormalizedChatMessage` and a send path. The bot adapter and the desk reader can share the protocol code in `src/shared`.
6. If the site only delivers events to a public webhook, receive them in the relay and forward them on the existing socket. Do not open a public port from the desktop app.

Kick is wired that way. Rumble and TikTok can follow the same steps. Nothing in this tree speaks to them yet.

## Bot config and engine

`packages/bot/src/config.ts` loads and normalizes `bot.json`: commands, timers, filters, quotes, hooks, thanks, and shoutouts. `packages/bot/src/engine.ts` decides what one chat line does and when a timer is due. `packages/bot/src/model.ts` re-exports both, so existing imports keep working. `bot.json` from 0.5.0 and 0.8.1 loads unchanged. The golden files in `tests/fixtures/config/` are that contract.

## Saved files

The desk and the bot share one config directory (`~/.config/rascal` on Linux). Secret files are mode `0600` on Linux and macOS. The bot's own API key, Twitch tokens, and YouTube tokens are separate files from `settings.json`. Kick login, the Kick app, and the relay secret are `kick-tokens.json`, `kick-client.json`, and `kick-relay.json`. See the README for paths on Windows and macOS, including the Firebot import file and the default alert media folder.

## Desk tabs

The top bar lists Redeems, Stream info, Chat overlay, TTS, and Bot. Chat is the main panel and always shows. Settings is the gear and stays in the bar so a hidden panel can be turned back on. **Save settings** sits under the section list on the Settings screen. The choice of hidden panels is `tabs.hidden` in `settings.json` (`src/shared/desk-tabs.ts`). A file with no `tabs` key shows every panel. A saved list that names Chat still shows Chat. Stream info is where the YouTube card opens YouTube Studio. The message chime's output device is Settings → Alerts.

Hiding a panel removes its button. If that panel is open, the desk returns to Chat. The bot, platform connections, and overlays keep running. The headless bot does not read `tabs`.

Redeems is also hidden while Twitch is off in the platform picker. Turning Twitch off does not add Redeems to `tabs.hidden`. Turning Twitch back on shows Redeems again, unless the user hid it under Tabs.
