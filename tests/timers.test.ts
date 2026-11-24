import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TwitchChatPlatform } from "../packages/bot/src/platform/twitch-adapter";
import { BotService } from "../packages/bot/src/service";
import { BotStore } from "../packages/bot/src/store";
import {
  activePhase,
  advanceTimer,
  countTimerLine,
  defaultBotFile,
  dueTimers,
  normalizeBotFile,
  normalizeTimer,
  timerIsDue,
  timerMessage,
  type BotTimer,
} from "../packages/bot/src/model";
import { channelIdFromJwt, importStreamElements } from "../packages/bot/src/se";
import { expectPrivateMode } from "./expect-mode";
import fixture from "./fixtures/streamelements-bot.json";

function timer(patch: Partial<BotTimer> = {}): BotTimer {
  const base = normalizeTimer({
    name: "plug",
    messages: ["one", "two", "three"],
    mode: "both",
    intervalSec: 60,
    minChatLines: 0,
    offlineIntervalSec: 120,
    offlineMinChatLines: 0,
    enabled: true,
  });
  if (!base) throw new Error("timer fixture failed");
  return { ...base, ...patch, messages: patch.messages ?? base.messages };
}

describe("stream live status", () => {
  it("does not treat a connected Twitch chat as a live stream", () => {
    const platform = new TwitchChatPlatform({
      helix: {} as never,
      clientId: () => "",
      accessToken: async () => "",
      broadcasterId: () => "",
      botUserId: () => "",
      botLogin: () => "",
      fetchImpl: fetch,
      log: () => {},
      onBroadcasterId: () => {},
    });
    expect(platform.liveStatus()).toMatchObject({ connected: false, live: false, liveKnown: false });
    platform.setStreamLive(false);
    expect(platform.liveStatus()).toMatchObject({ live: false, liveKnown: true });
    platform.setStreamLive(true);
    expect(platform.liveStatus()).toMatchObject({ live: true, liveKnown: true, connected: false });
  });
});

describe("timer schedules", () => {
  it("keeps an older timer posting on one interval live or offline", () => {
    const loaded = normalizeBotFile({ timers: [{ name: "plug", message: "hey", intervalSec: 30, minChatLines: 4 }] });
    const saved = loaded.timers[0];
    expect(saved).toMatchObject({
      message: "hey",
      messages: ["hey"],
      mode: "both",
      intervalSec: 30,
      offlineIntervalSec: 30,
      minChatLines: 4,
      offlineMinChatLines: 4,
      platforms: "twitch",
    });
    expect(activePhase(saved!, null)).toBe("live");
    expect(activePhase(saved!, false)).toBe("offline");
  });

  it("uses the live schedule only while live and rotates every message", () => {
    const liveOnly = timer({ mode: "live", minChatLines: 2, linesSince: 2, lastFiredAt: 0 });
    expect(activePhase(liveOnly, false)).toBeNull();
    expect(activePhase(liveOnly, null)).toBeNull();
    expect(timerIsDue(liveOnly, 60_000, "live")).toBe(true);
    const file = { ...defaultBotFile(), timers: [liveOnly] };
    expect(dueTimers(file, 60_000, true).map((item) => item.name)).toEqual(["plug"]);
    expect(dueTimers(file, 60_000, false)).toEqual([]);
    expect(timerMessage(liveOnly)).toBe("one");
    const next = advanceTimer(liveOnly, 60_000, "live");
    expect(timerMessage(next)).toBe("two");
    expect(next.lastFiredAt).toBe(60_000);
    expect(next.linesSince).toBe(0);
    expect(timerMessage(advanceTimer(next, 120_000, "live"))).toBe("three");
    expect(timerMessage(advanceTimer(advanceTimer(next, 120_000, "live"), 180_000, "live"))).toBe("one");
  });

  it("keeps a separate offline clock and only counts lines for the active phase", () => {
    const both = timer({
      mode: "both",
      intervalSec: 30,
      offlineIntervalSec: 90,
      minChatLines: 1,
      offlineMinChatLines: 3,
      linesSince: 1,
      offlineLinesSince: 1,
      lastFiredAt: 0,
      offlineLastFiredAt: 0,
    });
    expect(timerIsDue(both, 30_000, "live")).toBe(true);
    expect(timerIsDue(both, 30_000, "offline")).toBe(false);
    expect(timerIsDue({ ...both, offlineLinesSince: 3 }, 90_000, "offline")).toBe(true);
    expect(countTimerLine(both, true).linesSince).toBe(2);
    expect(countTimerLine(both, true).offlineLinesSince).toBe(1);
    expect(countTimerLine(both, false).offlineLinesSince).toBe(2);
    expect(countTimerLine(timer({ mode: "live" }), false).linesSince).toBe(0);
    const advanced = advanceTimer(both, 90_000, "offline");
    expect(advanced.offlineLastFiredAt).toBe(90_000);
    expect(advanced.lastFiredAt).toBe(0);
    expect(timerMessage(advanced)).toBe("two");
  });
});

describe("timer editing", () => {
  it("updates interval and messages on an existing timer and restarts that countdown", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-timer-"));
    const service = new BotService(new BotStore(dir), { clientId: () => "", log: () => {} });
    service.saveTimer({ name: "plug", message: "one", intervalSec: 600, minChatLines: 5, enabled: true });
    const created = service.snapshot(0).timers[0];
    expect(created?.id).toBeTruthy();
    expect(created?.mode).toBe("both");
    service.saveTimer(
      {
        id: created?.id,
        name: "plug",
        messages: ["one", "two"],
        mode: "both",
        intervalSec: 120,
        minChatLines: 5,
        offlineIntervalSec: 900,
        offlineMinChatLines: 1,
        enabled: true,
        platforms: "all",
      },
      5_000_000,
    );
    const updated = service.snapshot(0).timers;
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      id: created?.id,
      messages: ["one", "two"],
      intervalSec: 120,
      offlineIntervalSec: 900,
      offlineMinChatLines: 1,
      lastFiredAt: 5_000_000,
      offlineLastFiredAt: 5_000_000,
      platforms: "all",
    });
    service.saveTimer({ ...updated[0], message: "one", messages: ["one", "two"] }, 9_000_000);
    expect(service.snapshot(0).timers[0]?.lastFiredAt).toBe(5_000_000);
    const reloaded = new BotStore(dir).loadConfig().timers[0];
    expect(reloaded?.intervalSec).toBe(120);
    expect(reloaded?.messages).toEqual(["one", "two"]);
  });
});

describe("streamelements import", () => {
  it("keeps every timer message and maps online and offline minutes", () => {
    const imported = importStreamElements(fixture.commands, fixture.timers);
    expect(imported.commands[0]).toMatchObject({
      name: "so",
      response: "Go see ${user}",
      aliases: ["shout", "shoutout"],
      cooldownSec: 8,
      userCooldownSec: 20,
      level: "sub",
      count: 4,
      enabled: true,
    });
    expect(imported.commands[1]).toMatchObject({ name: "eightball", response: "{random:yes|no|maybe}", enabled: false });
    expect(imported.timers[0]).toMatchObject({
      id: "5c0aa9d3de9a4c4622a14e07",
      name: "Socials",
      mode: "live",
      messages: ["Follow ${user}", "Join the Discord", "Watch {title}"],
      message: "Follow ${user}",
      intervalSec: 300,
      offlineIntervalSec: 1800,
      minChatLines: 2,
      offlineMinChatLines: 2,
      platforms: "twitch",
    });
    expect(imported.timers[1]).toMatchObject({
      name: "Night offline",
      mode: "offline",
      messages: ["Be back soon", "VOD is up"],
      intervalSec: 600,
      offlineIntervalSec: 1200,
      minChatLines: 0,
    });
    expect(JSON.stringify(imported)).not.toContain("hidden");
  });

  it("stores a pasted jwt at mode 0600 and does not log it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-se-"));
    const store = new BotStore(dir);
    const secret = "jwt-TESTSECRET-not-real";
    const payload = Buffer.from(JSON.stringify({ channel: "a".repeat(24) })).toString("base64url");
    const jwt = `header.${payload}.${secret}`;
    const logs: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/commands/" + "a".repeat(24))) return Response.json(fixture.commands);
      if (url.endsWith("/timers/" + "a".repeat(24))) return Response.json(fixture.timers);
      return Response.json([], { status: 404 });
    };
    const service = new BotService(store, {
      clientId: () => "client",
      fetchImpl,
      log: (_level, message, extra) => logs.push(`${message} ${JSON.stringify(extra ?? {})}`),
    });
    await service.importSe(jwt);
    const saved = service.snapshot(0);
    expect(saved.timers).toHaveLength(2);
    expect(saved.timers[0]?.messages).toHaveLength(3);
    expect(saved.seJwtSet).toBe(true);
    expect(logs.join("\n")).not.toContain(secret);
    expect(logs.join("\n")).not.toContain(jwt);
    const secrets = fs.readFileSync(store.secretFile, "utf8");
    expect(secrets).toContain(secret);
    expectPrivateMode(store.secretFile, 0o600);
    expect(channelIdFromJwt(jwt)).toBe("a".repeat(24));
  });
});
