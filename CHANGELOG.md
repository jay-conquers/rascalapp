# Changelog

## 0.14.3

- The app icon is a sitting tabby facing left. The badge is charcoal, the cat is chestnut with espresso stripes and a cream outline, and the corners outside the circle are transparent.
- Desk and mod-portal surfaces are warm charcoal instead of cool blue-gray. Buttons, links, and the active highlight use a lighter chestnut so they stay readable on the dark background. Live, error, warning, and the Twitch, YouTube, and Kick colors are unchanged.

## 0.14.2

- The Kick relay closes a socket that sends a malformed frame, and it stops accepting new sockets after 32 are open. A bad webhook no longer makes the relay download Kick's public key again on every request. A webhook that is too large, or missing its signature headers, is closed instead of left hanging.
- Kick and YouTube login ignore a browser request whose state does not match the one Rascal started. The listener accepts both 127.0.0.1 and ::1. The Kick browser opens after that listener is up.
- Kick emote images show on the chat overlay. A Kick user id or category id that cannot be sent as a whole number is rejected, and category art is limited to Kick's own image hosts. Kick's client, token, and relay files are set to mode 0600 when they are read, including a file that was saved as group-readable.

## 0.14.1

- Sending chat to Kick from the desk reaches Kick. Saving Settings stores the Kick relay address. Both values were dropped on the way from the window into the main process.
- Shared helpers replace copied private-file writes, Kick JSON readers, the YouTube and Kick loopback login servers, and the EventSub session frames and socket timers.
- Startup no longer copies an old Ember config directory. `EMBER_*` environment variables are no longer read. The bot import note names `rascal-bot-config.json`.
- A `bot.json` or `settings.json` from an earlier Rascal version still loads.

## 0.14.0

- Settings is grouped into Platforms, Chat & Bot, Tabs, Alerts, Moderation, App, and Advanced. A list on the left jumps to each section.
- Platforms keeps the platform list, the channel for each one that is on, Twitch and Kick login, and the Kick relay address and secret. Turning Kick on still shows the relay notice, and Kick stays off until that notice is accepted. Chat still cannot be hidden. Settings stays in the bar.
- Chat & Bot holds the extra emote catalogs, which notices show in chat, and the bot connection. Embedded still runs the bot on this computer. Server still controls one bot you host.
- Alerts holds the message sound. A custom sound's full path is under Advanced.
- Moderation holds the private mod log. It is still never posted to chat or drawn on an overlay.
- App shows the version and, when Twitch is on, the switch that imports Firebot reward files on startup.
- Advanced holds the Twitch client ID, how to register the Twitch app, the consent-screen scopes, the Kick app id and secret, the overlay port, and the note about where tokens are stored. Every control from 0.13.0 is still there.
- Twitch and Kick both say Log in and Log out. The saved keys in settings.json, the defaults, and the bot connection fields are unchanged.

## 0.13.0

- Stream info edits the title on every platform that is turned on. Twitch and Kick also edit the category. YouTube has no game field in the live API, so the game title stays in YouTube Studio. A checkbox applies one title to all enabled platforms. Each platform keeps its own fields. A failure on one platform is shown there and does not stop the others.
- YouTube updates the active or upcoming live broadcast. Rascal fetches that broadcast and sends the same snippet back with only the title changed, so the description and the scheduled start stay as they were. Monitor-stream settings from that fetch are sent back unchanged, because an update drops a field it does not include. The save costs 50 quota units. It is not polled.
- A YouTube login that already has `youtube.force-ssl` can change the title without signing in again. A saved login whose scopes do not include `youtube` or `youtube.force-ssl` says that a new login is needed. Chat keeps working either way.
- The YouTube status has a Studio button. It opens the current livestream in the system browser when a broadcast id is known, the channel's livestreaming page when only the channel id is known, and Studio home otherwise. The address has to match the browser allowlist.
- Kick title and category use `PATCH /public/v1/channels`. Category search uses `GET /public/v2/categories`. Neither call uses the relay. New logins ask for `channel:write`. A login from 0.12.0 can still chat. Stream info asks for a new Kick login before the title can be saved.

## 0.12.0

- Kick is in the platform list. Turning it on shows a notice: Kick chat and events need Rascal hosting or a relay you run, and they do not arrive without one. Rascal hosting is not available yet. The notice links to the self-hosting steps. The Enable button stays off until **I understand** is ticked. Cancel leaves Kick off. The acknowledgement is saved, so the notice does not return every time Kick is opened. Clearing settings brings it back.
- Kick login uses your own Kick app, with OAuth 2.1 and PKCE. Chat is read through the relay. Sending a message, deleting one, timing a viewer out, banning, and unbanning use Kick's API and the moderation menu. A timeout is a whole number of minutes, from 1 minute to 7 days.
- A small relay is included. It checks Kick's webhook signature and forwards the event over a WebSocket. The shared secret is configured by you. Docker builds it next to the bot. The steps are in docs/kick-relay.md.
- Without a relay address and secret, Kick's status says **No relay configured**.
- Turning Kick off stops its socket and its API calls. The login stays saved.
- An install from 0.11.0 or earlier does not turn Kick on. A bot with no saved platform list still connects Twitch and YouTube only.
- Kick does not do channel-point redeems, a separate bot account, follow age, account age, shoutouts, or a full viewer list. Follows, subscriptions, gifted subscriptions, and Kicks gifts are not shown. Third-party emote providers are not applied to Kick messages.

## 0.11.0

- Panels in the top bar can be hidden. Settings has a Tabs section, with a checkbox for each panel. Chat is checked and stays on. Right-click a panel button and choose Hide tab. Settings stays in the bar, so a hidden panel can be turned back on.
- The choice is saved in settings.json. An install from 0.10.0 or earlier has no saved choice and still shows every panel.
- Hiding a panel removes it from the window. If that panel was open, the window returns to Chat. The bot, overlays, and connections keep running, including a bot you host yourself.
- Redeems is also hidden while Twitch is turned off under Platforms. That list is separate. Turning Twitch back on shows Redeems again, unless it is hidden under Tabs.

## 0.10.0

- Choose which platforms to connect. A new install asks once, with Twitch already checked. YouTube is the other choice today. At least one platform stays on. Settings has the same list, so it can be changed later.
- An install from 0.9.0 or earlier does not see that screen. A platform that already has a login, a channel, or a client id is selected. If none do, Twitch is selected.
- Turning a platform off hides its chat, viewer count, send target, stream info, mod tools, mentions, bot account, alerts, redeems, and login prompts. It also stops that platform's connections and API calls. Saved logins and settings stay put. Turning it back on restores them, and asks for a login when one is still needed.
- Kick is reserved in the platform list and stays hidden until it ships.

## 0.9.0

- Moderate from the chat column. Click or right-click a message or a name to delete it, time the viewer out (1 minute, 10 minutes, 1 hour, 24 hours, or a custom length), ban, or unban. Twitch uses Helix. YouTube uses the live chat Data API, with a temporary ban for a timeout. The menu leaves out actions the signed-in account cannot perform, asks before a ban, and will not act on the broadcaster. A failed request stays on the menu. Each action is written to the private mod log with who did it, what they did, who it was done to, the duration, and the platform.
- Twitch message deletes now send `message_id` as a query parameter. Leaving that parameter out asks Helix to clear the whole room.
- Twitch login now also asks for `moderator:manage:chat_messages`, `moderator:manage:banned_users`, and `moderator:read:chatters`. Chat keeps working with an older token. Log out and back in once so deletes, timeouts, bans, and the chatter list can run. Settings names the missing scopes until you do.
- Typing `@` in the chat box suggests names from the platforms that are connected and checked. Twitch merges Helix chatters with people who spoke this session. YouTube has no viewer list, so it uses people who spoke this session. A second platform shows a small marker on each name.
- The mod log's empty state says "No moderation actions yet." The Twitch login hint appears only when that login is missing the moderator read scopes. The YouTube note appears only when YouTube chat is connected.
- Channel-point redeems with no typed message show who redeemed them. Follows and other notices that name a viewer show that name too.
- Viewer counts in the header stay on one line inside the pill. A long label ellipsizes, and a narrow window shows the dot and the number instead of spilling into the buttons.
- The bot state no longer includes `askJeevesHook`. A `bot.json` that still has that key loads without it. The speech panel no longer shows that row.
- A moderator's `!timeout` on Twitch, and `!ban` on YouTube, now act on the named user. They used to act on the moderator who typed the command.
- Chat hooks. Each hook in `bot.json` can POST a viewer's command to an address you run. It is off until enabled. A secret signs the body, and the service can optionally return a short chat reply. `allowBroadcaster` lets the streamer's own messages fire that hook. The bot's own posts still do not.
- The bot can run on a server you control. `PUBLIC_BASE_URL` sets the Twitch and YouTube redirect addresses. See docs/self-hosting.md.

## 0.8.1

- A command can list keywords. A keyword or phrase in a normal message fires that command, on a word boundary, ignoring case. The command cooldown stops a busy chat from repeating it. StreamElements keyword phrases such as `on accident` import into this list.
- `{random.chatter}` picks someone who spoke in the last 10 minutes, skipping known bots and the broadcaster. `{random:one|two}` expands variables inside the choice it picks. Older StreamElements placeholders still work: `$(sender)`, `${1}`, `$(touser)`, and `${random.pick 'a' 'b'}`.
- Built-ins: `!followage` and `!howlong`, `!accountage` (optional `@name`, otherwise the sender), mod-only `!so`, `!quote` / `!quote add` / `!quote remove`, and `!cmds` as another name for `!commands`. Follow age and account age come from Helix. `!so` posts a configurable line with the target's login and last game, and calls Helix Send a Shoutout only when the token already has `moderator:manage:shoutouts`.
- Optional thank-you lines for follows, subs, resubs, gifted subs, cheers, raids, and channel-point redeems. Each is off until turned on. A notice that Settings hides, or that Rascal already dropped as a duplicate, does not get one. Gifted subs from the same person a few seconds apart become one line.
- Quotes and the thank-you and shoutout templates are stored in the bot config, next to commands.

## 0.8.0

- The Twitch and YouTube checks on the chat box are saved. Leaving the tab, restarting, or YouTube being offline does not clear them. A new install still sends to Twitch only. Offline platforms are skipped until their chat is available, then included again with no re-check.
- YouTube chat sends use the active live chat for the video on screen. An upcoming or finished broadcast that still has a chat id is not used. If YouTube rejects the send, the chat box shows YouTube's reason instead of only "HTTP 400".
- Twitch channel emotes, including subscriber emotes whose ids look like `emotesv2_…`, render in normal chat and in resub messages, in the desk and on the chat overlay. If anonymous IRC omits the emote tag, the channel set from Helix is used. When IRC and EventSub both deliver a notice, the copy that has the emote images is the one kept.
- Optional message chime in Settings. It is off until turned on. It plays for new viewer chat on a connected platform, including while the window is in the background, and skips your own messages, the bot, duplicates, chat history, and the mod log. Notices are a separate switch. A short built-in chime is included, or a local audio file.
- Twitch channel, subscriber, follower, and global emotes render from the emote ids on IRC messages and EventSub fragments. YouTube member and custom emoji render from the page reader's message runs.
- BetterTTV, FrankerFaceZ, and 7TV global and channel emotes each have a Settings switch. They default to on. Emote images are cached locally from the known CDNs, with no cookies or auth header on those fetches.
- Private mod log in Rascal's window for Twitch `channel.moderate` v2 (timeouts, bans, unbans, deletes, warnings, clears, mode changes, mod and unmod) and for the YouTube page-reader deletes and ban or timeout banners. It is never sent to chat or an overlay.
- Chat notices for subs, resubs, gifted subs, raids, cheers, follows, watch streaks, and mod anniversaries, plus YouTube Super Chats, Super Stickers, memberships, gifted memberships, and milestones. Channel point redeems show the reward, the redeemer, and their text. Each kind has a Settings switch.
- Live viewer counts: Twitch from Helix streams about every 60 seconds, YouTube from the live page so the Data API quota is not spent on it.
- Login now also asks for `user:read:chat`, `moderator:read:followers`, and the moderator read scopes `channel.moderate` v2 requires. An older token keeps working for chat until you log in again.

## 0.7.0

- Timers can run while a channel is live, offline, or both.
- A stored StreamElements JWT is reused when the import field is left empty.
