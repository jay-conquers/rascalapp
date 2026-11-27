import { describe, expect, it } from "vitest";
import { grantRendererPermission } from "../src/main/session-permissions";

describe("renderer permissions", () => {
  it("allows speaker selection and clipboard write, and denies capture", () => {
    expect(grantRendererPermission("speaker-selection")).toBe(true);
    expect(grantRendererPermission("clipboard-sanitized-write")).toBe(true);
    expect(grantRendererPermission("media")).toBe(false);
    expect(grantRendererPermission("display-capture")).toBe(false);
    expect(grantRendererPermission("clipboard-read")).toBe(false);
    expect(grantRendererPermission("geolocation")).toBe(false);
    expect(grantRendererPermission("unknown")).toBe(false);
  });
});
