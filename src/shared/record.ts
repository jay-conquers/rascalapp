/** A plain JSON object. Arrays are objects too; callers that need to reject them check Array.isArray. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
