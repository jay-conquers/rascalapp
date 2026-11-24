# Changelog

## 0.8.0

- The Twitch and YouTube checks on the chat box are saved. Leaving the tab, restarting, or YouTube being offline does not clear them. A new install still sends to Twitch only. Offline platforms are skipped until their chat is available, then included again with no re-check.
- Twitch channel, subscriber, follower, and global emotes render from the emote ids on IRC messages and EventSub fragments. YouTube member and custom emoji render from the page reader's message runs.
- BetterTTV, FrankerFaceZ, and 7TV global and channel emotes each have a Settings switch. They default to on. Emote images are cached locally from the known CDNs, with no cookies or auth header on those fetches.
- Private mod log in Rascal's window for Twitch `channel.moderate` v2 (timeouts, bans, unbans, deletes, warnings, clears, mode changes, mod and unmod) and for the YouTube page-reader deletes and ban or timeout banners. It is never sent to chat or an overlay.
- Chat notices for subs, resubs, gifted subs, raids, cheers, follows, watch streaks, and mod anniversaries, plus YouTube Super Chats, Super Stickers, memberships, gifted memberships, and milestones. Channel point redeems show the reward, the redeemer, and their text. Each kind has a Settings switch.
- Live viewer counts: Twitch from Helix streams about every 60 seconds, YouTube from the live page so the Data API quota is not spent on it.
- Login now also asks for `user:read:chat`, `moderator:read:followers`, and the moderator read scopes `channel.moderate` v2 requires. An older token keeps working for chat until you log in again.

## 0.7.0

- Timers can run while a channel is live, offline, or both.
- A stored StreamElements JWT is reused when the import field is left empty.
