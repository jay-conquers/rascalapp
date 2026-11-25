export function hookError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("The hook ") || message.startsWith("That address ")) return message.slice(0, 180);
  return "The hook did not answer.";
}

export function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Bot request failed.";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/OAuth\s+\S+/gi, "OAuth [redacted]").replace(/ya29\.[A-Za-z0-9_\-]+/g, "[redacted]").slice(0, 180);
}
