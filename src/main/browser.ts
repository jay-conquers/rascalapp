const ALLOWED_EXTERNAL = [
  /^https:\/\/www\.twitch\.tv\/activate(?:[/?#]|$)/,
  /^https:\/\/dev\.twitch\.tv\/console\/apps\/?(?:[?#]|$)/,
  /^https:\/\/dev\.twitch\.tv\/docs\/authentication(?:[/?#]|$)/,
  /^http:\/\/127\.0\.0\.1:\d+\/portal\/?$/,
  /^http:\/\/localhost:\d+\/portal\/?$/,
];

export function assertAllowedExternal(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That link cannot be opened.");
  }
  const href = parsed.toString();
  if (!ALLOWED_EXTERNAL.some((pattern) => pattern.test(href))) {
    throw new Error("That link cannot be opened.");
  }
  return href;
}
