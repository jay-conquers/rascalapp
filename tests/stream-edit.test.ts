import { describe, expect, it } from "vitest";
import { KICK_TITLE_RELOGIN } from "../src/shared/kick/channel";
import { applyStreamEdits, commitKickChannel, commitYoutubeTitle, planStreamEdits } from "../src/shared/stream-edit";
import { YOUTUBE_TITLE_RELOGIN } from "../src/shared/platform/youtube-broadcast";

describe("stream edits", () => {
  it("applies one title to each enabled platform and drops a game id for YouTube", () => {
    const planned = planStreamEdits({
      enabled: ["youtube", "twitch"],
      request: {
        applyAll: true,
        title: "Shared",
        edits: [
          { platform: "twitch", title: "ignored", gameId: "509658", tags: ["English"] },
          { platform: "youtube", title: "ignored", gameId: "should-not-send" },
          { platform: "kick", title: "off", gameId: "15" },
        ],
      },
    });
    expect(planned).toEqual([
      { platform: "twitch", title: "Shared", gameId: "509658", tags: ["English"] },
      { platform: "youtube", title: "Shared", gameId: undefined, tags: undefined },
    ]);
    const one = planStreamEdits({
      enabled: ["kick"],
      request: { applyAll: false, title: "", edits: [{ platform: "kick", title: "Solo", gameId: "15" }, { platform: "twitch", title: "nope", gameId: "1" }] },
    });
    expect(one).toEqual([{ platform: "kick", title: "Solo", gameId: "15", tags: undefined }]);
  });

  it("keeps going when one platform fails", async () => {
    const calls: string[] = [];
    const results = await applyStreamEdits(
      [
        { platform: "twitch", title: "A", gameId: "1", tags: [] },
        { platform: "youtube", title: "A" },
        { platform: "kick", title: "A", gameId: "9" },
      ],
      {
        twitch: async () => {
          calls.push("twitch");
          throw new Error("Twitch is down.");
        },
        youtube: async () => {
          calls.push("youtube");
        },
        kick: async () => {
          calls.push("kick");
        },
      },
    );
    expect(calls).toEqual(["twitch", "youtube", "kick"]);
    expect(results).toEqual([
      { platform: "twitch", ok: false, message: "Twitch is down." },
      { platform: "youtube", ok: true, message: "Saved." },
      { platform: "kick", ok: true, message: "Saved." },
    ]);
  });

  it("does not call YouTube or Kick when the saved login is missing the edit scope", async () => {
    let youtubeCalls = 0;
    let kickCalls = 0;
    await expect(
      commitYoutubeTitle({
        loggedIn: true,
        scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
        title: "Hello",
        save: async () => {
          youtubeCalls += 1;
        },
      }),
    ).rejects.toThrow(YOUTUBE_TITLE_RELOGIN);
    await expect(
      commitKickChannel({
        loggedIn: true,
        scopes: ["channel:read", "chat:write"],
        title: "Hello",
        categoryId: "15",
        save: async () => {
          kickCalls += 1;
        },
      }),
    ).rejects.toThrow(KICK_TITLE_RELOGIN);
    expect(youtubeCalls).toBe(0);
    expect(kickCalls).toBe(0);

    await commitYoutubeTitle({
      loggedIn: true,
      scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
      title: "Hello",
      save: async () => {
        youtubeCalls += 1;
      },
    });
    await commitKickChannel({
      loggedIn: true,
      scopes: ["channel:write"],
      title: "Hello",
      save: async () => {
        kickCalls += 1;
      },
    });
    expect(youtubeCalls).toBe(1);
    expect(kickCalls).toBe(1);
  });
});
