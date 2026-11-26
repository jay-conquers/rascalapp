import { describe, expect, it } from "vitest";
import { YoutubeDataApi } from "../src/shared/platform/youtube-api";
import {
  buildYoutubeBroadcastTitleUpdate,
  pickEditableBroadcast,
  youtubeBroadcastScopeMissing,
  youtubeTitleBlock,
  YOUTUBE_TITLE_RELOGIN,
} from "../src/shared/platform/youtube-broadcast";
import { YOUTUBE_QUOTA_COSTS, YoutubeQuotaMeter } from "../src/shared/platform/youtube-quota";

const FETCHED = {
  id: "abcdefghijk",
  snippet: {
    title: "Old title",
    description: "Keep this description.",
    scheduledStartTime: "2026-11-26T03:00:00Z",
    scheduledEndTime: "2026-11-26T06:00:00Z",
    categoryId: "20",
    channelId: "UCbroadcaster000000000001",
    liveChatId: "chat-should-not-be-sent",
  },
  status: { lifeCycleStatus: "live" },
  contentDetails: {
    monitorStream: { enableMonitorStream: true, broadcastStreamDelayMs: 0 },
    enableDvr: true,
  },
};

describe("YouTube broadcast title", () => {
  it("builds an update that changes only the title", () => {
    const picked = pickEditableBroadcast([FETCHED, { id: "donevideoid", snippet: { title: "Old", scheduledStartTime: "2020-01-01T00:00:00Z", description: "x" }, status: { lifeCycleStatus: "complete" } }]);
    expect(picked?.id).toBe("abcdefghijk");
    const update = buildYoutubeBroadcastTitleUpdate(picked!, "  New title  ");
    expect(update.part).toBe("snippet,contentDetails");
    expect(update.body.snippet).toEqual({
      title: "New title",
      description: "Keep this description.",
      scheduledStartTime: "2026-11-26T03:00:00Z",
      scheduledEndTime: "2026-11-26T06:00:00Z",
      categoryId: "20",
    });
    expect(update.body.contentDetails).toEqual({
      monitorStream: { enableMonitorStream: true, broadcastStreamDelayMs: 0 },
      enableDvr: true,
    });
    expect(JSON.stringify(update.body)).not.toMatch(/game/i);
    expect(JSON.stringify(update.body)).not.toContain("liveChatId");
    expect(YOUTUBE_QUOTA_COSTS.liveBroadcastsUpdate).toBe(50);
  });

  it("refuses a title when the fetch has no scheduled start", () => {
    const picked = pickEditableBroadcast([{ id: "abcdefghijk", snippet: { title: "Soon", description: "d" }, status: { lifeCycleStatus: "ready" } }]);
    expect(picked?.life).toBe("ready");
    expect(() => buildYoutubeBroadcastTitleUpdate(picked!, "Hello")).toThrow(/scheduled start/);
  });

  it("fetches the known broadcast once, then updates only the title", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if ((init?.method ?? "GET") === "GET") return json({ items: [FETCHED] });
      return json({ id: "abcdefghijk" });
    };
    const meter = new YoutubeQuotaMeter();
    const api = new YoutubeDataApi({ token: async () => "ya29.SECRET", fetchImpl, meter });
    await api.updateLiveTitle("New title", "abcdefghijk");
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
    expect(calls[0]?.url).toContain("id=abcdefghijk");
    expect(calls[0]?.url).toContain("part=snippet%2Cstatus%2CcontentDetails");
    expect(calls[0]?.url).not.toContain("broadcastStatus");
    const sent = JSON.parse(calls[1]?.body ?? "{}") as { snippet: { title: string; description: string; scheduledStartTime: string } };
    expect(sent.snippet.title).toBe("New title");
    expect(sent.snippet.description).toBe("Keep this description.");
    expect(sent.snippet.scheduledStartTime).toBe("2026-11-26T03:00:00Z");
    expect(calls[1]?.url).toContain("part=snippet%2CcontentDetails");
    const sentDetails = JSON.parse(calls[1]?.body ?? "{}") as { contentDetails: { enableDvr: boolean } };
    expect(sentDetails.contentDetails.enableDvr).toBe(true);
    expect(meter.usedUnits).toBe(YOUTUBE_QUOTA_COSTS.liveBroadcastsList + YOUTUBE_QUOTA_COSTS.liveBroadcastsUpdate);
    expect(JSON.stringify(calls)).not.toContain("ya29.SECRET");
  });

  it("does not update when the title is empty, and skips a completed broadcast for an active one", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("id=")) {
        return json({ items: [{ id: "abcdefghijk", snippet: { title: "Done", description: "d", scheduledStartTime: "2020-01-01T00:00:00Z" }, status: { lifeCycleStatus: "complete" } }] });
      }
      if (url.includes("broadcastStatus=active")) {
        return json({ items: [{ ...FETCHED, id: "livevideoid1", snippet: { ...FETCHED.snippet, title: "Live" } }] });
      }
      return json({ items: [] });
    };
    const api = new YoutubeDataApi({ token: async () => "token", fetchImpl });
    await expect(api.updateLiveTitle("  ")).rejects.toThrow(/empty/);
    expect(calls).toEqual([]);
    await api.updateLiveTitle("Renamed", "abcdefghijk");
    expect(calls.some((url) => url.includes("broadcastStatus=upcoming"))).toBe(false);
    expect(calls.filter((url) => url.includes("broadcastStatus=active") || url.includes("id=abcdefghijk")).length).toBe(2);
  });

  it("falls through to upcoming when nothing is active", async () => {
    const statuses: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      statuses.push(new URL(url).searchParams.get("broadcastStatus") ?? "id");
      if ((init?.method ?? "GET") === "PUT") return json({});
      if (url.includes("broadcastStatus=upcoming")) {
        return json({
          items: [{ id: "upcomingid01", snippet: { title: "Later", description: "", scheduledStartTime: "2026-12-01T00:00:00Z" }, status: { lifeCycleStatus: "ready" } }],
        });
      }
      return json({ items: [] });
    };
    const api = new YoutubeDataApi({ token: async () => "token", fetchImpl });
    await api.updateLiveTitle("Later renamed");
    expect(statuses).toEqual(["active", "upcoming", "id"]);
  });

  it("turns a missing broadcast scope into a re-login message and leaves a force-ssl login alone", () => {
    expect(youtubeBroadcastScopeMissing(["https://www.googleapis.com/auth/youtube.readonly"])).toBe(true);
    expect(youtubeTitleBlock({ loggedIn: true, scopes: ["https://www.googleapis.com/auth/youtube.readonly"] })).toBe(YOUTUBE_TITLE_RELOGIN);
    expect(youtubeTitleBlock({ loggedIn: true, scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"] })).toBeNull();
    expect(youtubeTitleBlock({ loggedIn: true, scopes: ["https://www.googleapis.com/auth/youtube"] })).toBeNull();
    expect(youtubeTitleBlock({ loggedIn: true, scopes: [] })).toBeNull();
    expect(youtubeTitleBlock({ loggedIn: false, scopes: [] })).toMatch(/Connect a YouTube account/);
  });

  it("maps insufficientPermissions to the re-login message", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      if ((init?.method ?? "GET") === "GET") return json({ items: [FETCHED] });
      return json({ error: { errors: [{ reason: "insufficientPermissions", message: "Insufficient Permission" }], code: 403 } }, 403);
    };
    const api = new YoutubeDataApi({ token: async () => "token", fetchImpl });
    await expect(api.updateLiveTitle("New title", "abcdefghijk")).rejects.toThrow(YOUTUBE_TITLE_RELOGIN);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
