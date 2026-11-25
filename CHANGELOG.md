# Changelog

## Unreleased

- Chat hooks. Each hook in `bot.json` can POST a viewer's command to an address you run. It is off until enabled. A secret signs the body, and the service can optionally return a short chat reply.

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
