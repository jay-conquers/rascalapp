# Changelog

## 0.14.5

First public release.

- Desktop app for Twitch, YouTube, and Kick: chat, moderation, a chat bot, channel-point alerts, OBS overlays, and a headless bot you can host yourself.
- Linux x64 AppImage, unsigned Windows x64 NSIS installer, and unsigned macOS Apple Silicon (arm64) DMG. An Intel Mac build is not produced. Checksums are in `SHA256SUMS.txt`.
- macOS has the standard application menu (About, Edit, and Window), including Quit (Command+Q) and copy/paste. Linux and Windows have no application menu.
- The Windows taskbar uses the app id `app.rascal.desktop`.
- The macOS icon includes the 1024 pixel image. The window uses the system font on macOS and Windows, then Noto Sans, Liberation Sans, and DejaVu Sans.
- The message chime can play through a chosen output device. The packaged window allows a blob audio element so the chime's media-element fallback can play.
