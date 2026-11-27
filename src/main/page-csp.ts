/**
 * Policy for the packaged renderer.
 * `media-src` keeps the chat chime's HTMLAudioElement blob fallback from being blocked.
 */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: http://127.0.0.1:* http://localhost:* https://static-cdn.jtvnw.net https://cdn.betterttv.net https://cdn.frankerfacez.com https://cdn.7tv.app https://yt3.ggpht.com https://yt3.googleusercontent.com https://i.ytimg.com https://lh3.googleusercontent.com https://files.kick.com https://kick.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
].join("; ");
