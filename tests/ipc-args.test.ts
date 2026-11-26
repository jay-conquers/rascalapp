import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asDestinations, asSettingsPatch } from "../src/main/ipc-args";
import { Runtime } from "../src/main/runtime";
import { bodyOf, fetchRouter, json } from "./helpers/fetch-router";
import { tempDir, writeJson } from "./helpers/bot";

describe("IPC argument parsers", () => {
  it("keeps a Kick send check and drops a non-boolean", () => {
    expect(asDestinations({ twitch: false, youtube: false, kick: true })).toEqual({ twitch: false, youtube: false, kick: true });
    expect(asDestinations({ twitch: true, kick: "yes" })).toEqual({ twitch: true });
    expect(asDestinations(null)).toBeUndefined();
  });

  it("keeps the Kick relay address and drops a non-string", () => {
    expect(asSettingsPatch({ kickRelayUrl: "wss://relay.example/v1/events", twitchChannel: "Example" })).toEqual({
      kickRelayUrl: "wss://relay.example/v1/events",
      twitchChannel: "Example",
    });
    expect(asSettingsPatch({ kickRelayUrl: 12, overlayPort: 4777 })).toEqual({ overlayPort: 4777 });
    expect(() => asSettingsPatch(null)).toThrow("Settings were incomplete.");
  });
});

describe("IPC handlers through the desk runtime", () => {
  it("sends a Kick-only chat line that the parser kept", async () => {
    const dir = tempDir("rascal-ipc-");
    writeJson(dir, "settings.json", {
      platforms: { confirmed: true, enabled: ["kick"], kickAcknowledged: true },
    });
    writeJson(dir, "kick-tokens.json", {
      clientId: "kickclient",
      accessToken: "kick-access-TESTTOKEN",
      refreshToken: "kick-refresh-TESTTOKEN",
      expiresAt: Date.now() + 24 * 3600_000,
      scopes: ["chat:write"],
      userId: "4242",
      login: "rascal",
      slug: "rascal",
    });
    const { fetchImpl, calls } = fetchRouter((request) => {
      if (request.where === "api.kick.com/public/v1/chat" && request.method === "POST") return json({});
      return undefined;
    });
    const runtime = new Runtime({ dir, version: "0.14.0", fetchImpl });
    const destinations = asDestinations({ twitch: false, youtube: false, kick: true });
    await runtime.sendChat("hello kick", destinations);
    const sent = calls.filter((call) => call.where === "api.kick.com/public/v1/chat");
    expect(sent).toHaveLength(1);
    expect(bodyOf(sent[0])).toEqual({ broadcaster_user_id: 4242, content: "hello kick", type: "user" });
    expect(sent[0]?.headers.authorization).toBe("Bearer kick-access-TESTTOKEN");
  });

  it("persists the Kick relay address that the parser kept", async () => {
    const dir = tempDir("rascal-ipc-");
    const runtime = new Runtime({ dir, version: "0.14.0" });
    const patch = asSettingsPatch({ kickRelayUrl: " wss://relay.example/v1/events " });
    const saved = await runtime.updateSettings(patch);
    expect(saved.kickRelayUrl).toBe("wss://relay.example/v1/events");
    const file = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")) as { kickRelayUrl: string };
    expect(file.kickRelayUrl).toBe("wss://relay.example/v1/events");
  });
});
