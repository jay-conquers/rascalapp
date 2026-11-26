import { kickTitleBlock } from "./kick/channel";
import { youtubeTitleBlock } from "./platform/youtube-broadcast";
import type { Platform, StreamInfo } from "./types";

export interface PlatformStreamDraft {
  platform: Platform;
  title: string;
  /** Twitch game id or Kick category id. YouTube has no game field. */
  gameId?: string;
  /** Twitch tags. Other platforms ignore them. */
  tags?: string[];
}

export interface StreamEditRequest {
  applyAll: boolean;
  /** Used when applyAll is set. Per-platform titles are used otherwise. */
  title: string;
  edits: PlatformStreamDraft[];
}

export interface PlatformStreamResult {
  platform: Platform;
  ok: boolean;
  message: string;
}

export interface StreamEditResult {
  results: PlatformStreamResult[];
  /** Twitch channel after a successful Twitch save. Unchanged otherwise. */
  stream: StreamInfo | null;
}

const ORDER: readonly Platform[] = ["twitch", "youtube", "kick"];

/**
 * Enabled platforms only. Apply-all copies one title onto each of them and
 * keeps that platform's category and tags. YouTube never receives a game id.
 */
export function planStreamEdits(input: { enabled: readonly string[]; request: StreamEditRequest }): PlatformStreamDraft[] {
  const enabled = new Set(input.enabled);
  if (input.request.applyAll) {
    return ORDER.filter((platform) => enabled.has(platform)).map((platform) => {
      const own = input.request.edits.find((edit) => edit.platform === platform);
      return draftFor(platform, input.request.title, own);
    });
  }
  return input.request.edits
    .filter((edit) => enabled.has(edit.platform) && ORDER.includes(edit.platform))
    .map((edit) => draftFor(edit.platform, edit.title, edit));
}

export async function applyStreamEdits(
  drafts: readonly PlatformStreamDraft[],
  handlers: { [K in Platform]?: (draft: PlatformStreamDraft) => Promise<void> },
): Promise<PlatformStreamResult[]> {
  return Promise.all(
    drafts.map(async (draft) => {
      const handler = handlers[draft.platform];
      if (!handler) return { platform: draft.platform, ok: false, message: "That platform is turned off." };
      try {
        await handler(draft);
        return { platform: draft.platform, ok: true, message: "Saved." };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not update the stream.";
        return { platform: draft.platform, ok: false, message };
      }
    }),
  );
}

/** Does not call save when the YouTube login cannot edit broadcasts. */
export async function commitYoutubeTitle(input: {
  loggedIn: boolean;
  scopes: readonly string[];
  title: string;
  preferredVideoId?: string;
  save: (title: string, preferredVideoId?: string) => Promise<void>;
}): Promise<void> {
  const block = youtubeTitleBlock(input);
  if (block) throw new Error(block);
  await input.save(input.title, input.preferredVideoId);
}

/** Does not call save when the Kick login is missing channel:write. */
export async function commitKickChannel(input: {
  loggedIn: boolean;
  scopes: readonly string[];
  title: string;
  categoryId?: string;
  save: (title: string, categoryId: string) => Promise<void>;
}): Promise<void> {
  const block = kickTitleBlock(input);
  if (block) throw new Error(block);
  await input.save(input.title, input.categoryId ?? "");
}

function draftFor(platform: Platform, title: string, own: PlatformStreamDraft | undefined): PlatformStreamDraft {
  return {
    platform,
    title,
    gameId: platform === "youtube" ? undefined : own?.gameId,
    tags: platform === "twitch" ? own?.tags ?? [] : undefined,
  };
}
