import { describe, expect, it } from "vitest";
import { checkHookUrl } from "../packages/bot/src/chat-hook";
import { validateBotServerUrl } from "../packages/bot/src/model";
import { parsePublicBaseUrl, portalRedirectUri, youtubePublicRedirect } from "../packages/bot/src/public-url";
import { youtubeRedirectUri } from "../src/shared/platform/youtube-oauth";

describe("self-host public address", () => {
  it("derives the Twitch and YouTube redirects from the public origin", () => {
    expect(parsePublicBaseUrl("https://bot.example.com/portal")).toBe("https://bot.example.com");
    expect(portalRedirectUri("https://bot.example.com", 4788)).toBe("https://bot.example.com/portal/callback");
    expect(youtubePublicRedirect("https://bot.example.com/")).toBe("https://bot.example.com/youtube/callback");
    expect(parsePublicBaseUrl("http://localhost:4788/ignored")).toBe("http://localhost:4788");
    expect(portalRedirectUri("", 4788)).toBe("http://localhost:4788/portal/callback");
    expect(youtubePublicRedirect("")).toBe(youtubeRedirectUri());
  });

  it("rejects a public http address, a password in the URL, and a desktop server that is not https", () => {
    expect(parsePublicBaseUrl("http://bot.example.com")).toBe("");
    expect(parsePublicBaseUrl("https://user:secret@bot.example.com")).toBe("");
    expect(validateBotServerUrl("https://bot.example.com/portal")).toBe("https://bot.example.com");
    expect(validateBotServerUrl("http://localhost:4788")).toBe("http://localhost:4788");
    expect(() => validateBotServerUrl("http://bot.example.com")).toThrow(/https/);
  });

  it("allows a private http hook only when that option is on", () => {
    expect(checkHookUrl("http://reader:8787/hook", false)).toBe("");
    expect(checkHookUrl("http://reader:8787/hook", true)).toContain("reader:8787");
    expect(checkHookUrl("http://10.1.2.3/hook", true)).toContain("10.1.2.3");
    expect(checkHookUrl("http://169.254.169.254/", true)).toBe("");
    expect(checkHookUrl("https://hooks.example/in", false)).toContain("https://hooks.example/in");
  });
});
