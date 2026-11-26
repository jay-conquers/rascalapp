import { describe, expect, it } from "vitest";
import {
  SessionChatters,
  applyMention,
  chatterPageCursor,
  mentionSuggestions,
  mentionToken,
  openMentionDirectories,
  parseChatterRows,
  stepMention,
  type ChatterDirectory,
  type MentionPlatformGate,
} from "../src/shared/mentions";

const twitch: ChatterDirectory = {
  id: "twitch",
  label: "Twitch",
  listed: [
    { name: "Ace", login: "ace" },
    { name: "Cedar", login: "cedar" },
  ],
  session: [{ name: "Bee", login: "bee" }],
};

const youtube: ChatterDirectory = {
  id: "youtube",
  label: "YouTube",
  listed: [],
  session: [{ name: "Dee" }, { name: "Bee" }],
};

/** A future site with no viewer-list API. Session names are the whole directory. */
const kick: ChatterDirectory = {
  id: "kick",
  label: "Kick",
  listed: [],
  session: [{ name: "Nova", login: "nova" }],
};

describe("mention directories", () => {
  it("keeps only platforms that are connected and enabled", () => {
    const gates: MentionPlatformGate[] = [
      { id: "twitch", enabled: true, connected: true },
      { id: "youtube", enabled: true, connected: false },
      { id: "kick", enabled: false, connected: true },
    ];
    expect(openMentionDirectories([twitch, youtube, kick], gates).map((directory) => directory.id)).toEqual(["twitch"]);
  });

  it("filters session and listed names, and lets a session-only site plug in the same way", () => {
    const open = openMentionDirectories(
      [twitch, youtube, kick],
      [
        { id: "twitch", enabled: true, connected: true },
        { id: "youtube", enabled: true, connected: true },
        { id: "kick", enabled: true, connected: true },
      ],
    );
    expect(mentionSuggestions(open, "").map((hit) => `${hit.platform}:${hit.name}`)).toEqual([
      "twitch:Bee",
      "youtube:Bee",
      "kick:Nova",
      "twitch:Ace",
      "youtube:Dee",
      "twitch:Cedar",
    ]);
    expect(mentionSuggestions(open, "ac").map((hit) => hit.name)).toEqual(["Ace"]);
    expect(mentionSuggestions(open, "@no").map((hit) => `${hit.platform}:${hit.name}`)).toEqual(["kick:Nova"]);
    expect(mentionSuggestions([youtube], "be")).toEqual([{ platform: "youtube", label: "YouTube", name: "Bee" }]);
  });

  it("remembers the latest session name and drops a cleared platform", () => {
    const session = new SessionChatters();
    session.note("twitch", { name: "Ace", login: "ace" });
    session.note("twitch", { name: "AceAgain", login: "ace" });
    session.note("youtube", { name: "Dee" });
    expect(session.list("twitch")).toEqual([{ name: "AceAgain", login: "ace" }]);
    session.clear("twitch");
    expect(session.list("twitch")).toEqual([]);
    expect(session.list("youtube")).toEqual([{ name: "Dee" }]);
  });
});

describe("mention editing", () => {
  it("finds the @ token at the cursor and inserts the chosen name", () => {
    expect(mentionToken("hi @ac", 6)).toEqual({ start: 3, query: "ac" });
    expect(mentionToken("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionToken("say a@b now", 7)).toBeNull();
    expect(mentionToken("hi @ace there", 8)).toBeNull();
    expect(applyMention("hi @ac", 3, 6, "Ace")).toEqual({ text: "hi @Ace ", cursor: 8 });
    expect(stepMention(0, 3, -1)).toBe(2);
    expect(stepMention(2, 3, 1)).toBe(0);
  });
});

describe("chatter pages", () => {
  it("reads Helix chatter rows and the next cursor", () => {
    expect(
      parseChatterRows([
        { user_id: "1", user_login: "ace", user_name: "Ace" },
        { user_login: "  " },
        { nope: true },
        "skip",
      ]),
    ).toEqual([{ name: "Ace", login: "ace" }]);
    expect(chatterPageCursor({ pagination: { cursor: "page-2" } })).toBe("page-2");
    expect(chatterPageCursor({ data: [] })).toBe("");
    expect(parseChatterRows(null)).toEqual([]);
  });
});
