# Changelog

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
