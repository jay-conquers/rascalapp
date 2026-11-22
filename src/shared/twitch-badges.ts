/** Index Helix `Get Global Chat Badges` / `Get Channel Chat Badges` into set/version image URLs. */
export function indexHelixBadges(payload: unknown): Record<string, string> {
  const data = asRecord(payload)?.data;
  if (!Array.isArray(data)) return {};
  const out: Record<string, string> = {};
  for (const set of data) {
    const row = asRecord(set);
    const setId = typeof row?.set_id === "string" ? row.set_id : "";
    const versions = Array.isArray(row?.versions) ? row.versions : [];
    for (const version of versions) {
      const item = asRecord(version);
      const id = typeof item?.id === "string" ? item.id : "";
      const url = https(item?.image_url_2x) || https(item?.image_url_4x) || https(item?.image_url_1x);
      if (setId && id && url) out[`${setId}/${id}`] = url;
    }
  }
  return out;
}

function https(value: unknown): string {
  return typeof value === "string" && value.startsWith("https://") ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
