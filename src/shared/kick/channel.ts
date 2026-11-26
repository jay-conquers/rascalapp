import { KICK_TITLE_MAX } from "../defaults";
import { jsonObject, scalarText } from "../record";
import type { CategoryHit } from "../types";

/**
 * Kick channel edits go to PATCH /public/v1/channels.
 * That call is the public API. It does not use the relay.
 * https://docs.kick.com/apis/channels
 */

export const KICK_CHANNEL_WRITE = "channel:write";

export const KICK_TITLE_RELOGIN =
  "Re-login needed. This Kick login is missing channel:write. Log out and log in again to edit the title and category. Chat keeps working.";

export interface KickChannelPatch {
  stream_title: string;
  category_id?: number;
}

/** Title is required. category_id is sent only when a search result was chosen. */
export function buildKickChannelPatch(input: { title: string; categoryId?: string }): KickChannelPatch {
  const title = input.title.trim();
  if (!title) throw new Error("Title cannot be empty.");
  if ([...title].length > KICK_TITLE_MAX) {
    throw new Error(`Kick titles stop at ${KICK_TITLE_MAX} characters.`);
  }
  const body: KickChannelPatch = { stream_title: title };
  const category = input.categoryId?.trim() ?? "";
  if (!category) return body;
  const categoryId = kickInteger(category);
  if (categoryId === null) throw new Error("Pick a category from the search results.");
  body.category_id = categoryId;
  return body;
}

/** A Kick id that JSON can round-trip. A longer digit string would become a different number. */
export function kickInteger(value: string): number | null {
  if (!/^\d{1,16}$/.test(value)) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

/** Category art is drawn in the desk. Only Kick's own https hosts are kept. */
export function kickArtworkUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  const host = url.hostname;
  if (host !== "kick.com" && host !== "files.kick.com" && !host.endsWith(".kick.com")) return "";
  return url.toString();
}

/**
 * GET /public/v2/categories. v1 category search is deprecated.
 * `name` must be 3 to 100 characters.
 */
export function kickCategorySearchPath(query: string): string | null {
  const name = query.trim();
  if ([...name].length < 3 || [...name].length > 100) return null;
  const params = new URLSearchParams({ name, limit: "8" });
  return `/categories?${params.toString()}`;
}

export function parseKickCategories(payload: unknown): CategoryHit[] {
  const data = jsonObject(payload)?.data;
  const rows = Array.isArray(data) ? data : [];
  const hits: CategoryHit[] = [];
  for (const row of rows) {
    const item = jsonObject(row);
    const id = scalarText(item?.id);
    const name = scalarText(item?.name);
    if (kickInteger(id) === null || !name) continue;
    hits.push({ id, name, boxArtUrl: kickArtworkUrl(scalarText(item?.thumbnail)) });
    if (hits.length >= 8) break;
  }
  return hits;
}

/** A saved login without channel:write can still chat. Editing asks for a new login. */
export function kickTitleBlock(input: { loggedIn: boolean; scopes: readonly string[] }): string | null {
  if (!input.loggedIn) return "Log in with Kick to change the title and category.";
  if (!input.scopes.includes(KICK_CHANNEL_WRITE)) return KICK_TITLE_RELOGIN;
  return null;
}
