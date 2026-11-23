const SECRET =
  /(?:oauth:|bearer\s+|authorization:\s*oauth\s+)[a-z0-9._\-+/=]+|"?(?:access_token|refresh_token|device_code|client_secret|id_token)"?\s*[:=]\s*"?[^"&\s,}]+|ya29\.[a-z0-9_\-]+/gi;

export function redact(value: string): string {
  return value.replace(SECRET, (match) => {
    const key = match.match(/access_token|refresh_token|device_code|client_secret|id_token|oauth:|bearer|authorization/i);
    if (!key) return "[redacted]";
    const label = key[0].toLowerCase().replace(/\s+/g, " ");
    if (label.startsWith("bearer")) return "Bearer [redacted]";
    if (label.startsWith("authorization")) return "Authorization: OAuth [redacted]";
    if (label.startsWith("oauth:")) return "oauth:[redacted]";
    return `${key[0]}=[redacted]`;
  });
}

export function redactError(err: unknown): string {
  if (err instanceof Error) return redact(err.message);
  return redact(String(err));
}
