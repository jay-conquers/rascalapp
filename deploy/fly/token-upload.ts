/** Checks for the one-shot config upload. The script prints warnings, never token values. */

export const TOKEN_UPLOAD_WARNING = [
  "Uploading bot-tokens.json copies the bot's Twitch access token and refresh token to that server.",
  "Whoever can read the server can chat and moderate as the bot until you revoke the token in Twitch.",
  "Prefer logging the bot in from Rascal so the server gets its own session.",
  "This command does not print the tokens.",
].join(" ");

export function assertRemoteOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The upload URL is not valid.");
  }
  if (url.username || url.password) throw new Error("The upload URL must not include a password.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
  throw new Error("Refusing to upload bot config or tokens over plain HTTP. Use https, or http://localhost for a local test.");
}

export function tokenModeWarning(mode: number | null, platform = process.platform): string | null {
  if (mode === null || platform === "win32") return null;
  if ((mode & 0o077) !== 0) {
    return "bot-tokens.json is readable by other accounts on this computer. Run chmod 600 on it. The upload was not cancelled.";
  }
  return null;
}
