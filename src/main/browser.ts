const ALLOWED_EXTERNAL = [
  /^https:\/\/www\.twitch\.tv\/activate(?:[/?#]|$)/,
  /^https:\/\/dev\.twitch\.tv\/console\/apps\/?(?:[?#]|$)/,
  /^https:\/\/dev\.twitch\.tv\/docs\/authentication(?:[/?#]|$)/,
  /^http:\/\/127\.0\.0\.1:\d+\/portal\/?$/,
  /^http:\/\/localhost:\d+\/portal\/?$/,
  /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth(?:[?#]|$)/,
  /^https:\/\/console\.cloud\.google\.com\/apis\/credentials(?:[/?#]|$)/,
  /^https:\/\/console\.cloud\.google\.com\/apis\/library\/youtube\.googleapis\.com(?:[/?#]|$)/,
  /^https:\/\/console\.cloud\.google\.com\/apis\/api\/youtube\.googleapis\.com(?:[/?#]|$)/,
  /^https:\/\/id\.kick\.com\/oauth\/authorize(?:[?#]|$)/,
  /^https:\/\/kick\.com\/settings\/developer(?:[/?#]|$)/,
  /^https:\/\/docs\.kick\.com\/(?:[^\s]*)?$/,
  /^https:\/\/github\.com\/jay-conquers\/rascalapp\/blob\/main\/docs\/kick-relay\.md(?:[?#]|$)/,
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
