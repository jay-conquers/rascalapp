import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { browserUserAgent } from "../src/shared/defaults";
import {
  configDir,
  configHome,
  currentPathHost,
  defaultAssetFolder,
  electronUserDataDir,
  fileUrl,
  firebotRewardsFile,
  usePathHost,
  type PathHost,
} from "../src/shared/paths";

function host(platform: NodeJS.Platform, patch: Partial<PathHost> = {}): PathHost {
  const homedir = platform === "win32" ? path.join("/Users", "tester") : platform === "darwin" ? path.join("/Users", "tester") : path.join("/home", "tester");
  return {
    platform,
    homedir,
    env: {},
    ...patch,
  };
}

afterEach(() => {
  usePathHost(null);
});

describe("config paths", () => {
  it("keeps the Linux XDG locations, including Rascal next to rascal", () => {
    const linux = host("linux");
    expect(configHome(linux)).toBe(path.join("/home", "tester", ".config"));
    expect(configDir(linux)).toBe(path.join("/home", "tester", ".config", "rascal"));
    expect(electronUserDataDir(linux)).toBe(path.join("/home", "tester", ".config", "Rascal"));
    expect(defaultAssetFolder(linux)).toBe(path.join("/home", "tester", "Streaming", "Rascal-Assets", "Sounds"));
  });

  it("honors XDG_CONFIG_HOME and ignores an Electron appData override on Linux", () => {
    const linux = host("linux", {
      appData: path.join("/electron", "config"),
      env: { XDG_CONFIG_HOME: path.join("/xdg", "config") },
    });
    expect(configDir(linux)).toBe(path.join("/xdg", "config", "rascal"));
    expect(electronUserDataDir(linux)).toBe(path.join("/xdg", "config", "Rascal"));
    expect(firebotRewardsFile(linux)).toBe(path.join("/xdg", "config", "Firebot", "v5", "profiles", "Main", "channel-rewards.json"));
  });

  it("treats an empty XDG_CONFIG_HOME as unset", () => {
    const linux = host("linux", { env: { XDG_CONFIG_HOME: "" } });
    expect(configDir(linux)).toBe(path.join("/home", "tester", ".config", "rascal"));
  });

  it("uses Application Support on macOS", () => {
    const mac = host("darwin", {
      appData: path.join("/Users", "tester", "Library", "Application Support"),
      music: path.join("/Users", "tester", "Music"),
    });
    expect(configHome(mac)).toBe(path.join("/Users", "tester", "Library", "Application Support"));
    expect(configDir(mac)).toBe(path.join("/Users", "tester", "Library", "Application Support", "Rascal"));
    expect(electronUserDataDir(mac)).toBe(configDir(mac));
    expect(defaultAssetFolder(mac)).toBe(path.join("/Users", "tester", "Music", "Rascal-Assets", "Sounds"));
    expect(firebotRewardsFile(mac)).toBe(
      path.join("/Users", "tester", "Library", "Application Support", "Firebot", "v5", "profiles", "Main", "channel-rewards.json"),
    );
  });

  it("uses APPDATA on Windows and prefers the Electron appData path", () => {
    const win = host("win32", {
      appData: path.join("/Users", "tester", "AppData", "Roaming"),
      env: { APPDATA: path.join("/ignored", "Roaming") },
      music: path.join("/Users", "tester", "Music"),
    });
    expect(configDir(win)).toBe(path.join("/Users", "tester", "AppData", "Roaming", "Rascal"));
    expect(electronUserDataDir(win)).toBe(configDir(win));
    expect(defaultAssetFolder(win)).toBe(path.join("/Users", "tester", "Music", "Rascal-Assets", "Sounds"));
    expect(firebotRewardsFile(win)).toBe(
      path.join("/Users", "tester", "AppData", "Roaming", "Firebot", "v5", "profiles", "Main", "channel-rewards.json"),
    );
    const fromEnv = host("win32", { env: { APPDATA: path.join("/env", "Roaming") } });
    expect(firebotRewardsFile(fromEnv)).toBe(
      path.join("/env", "Roaming", "Firebot", "v5", "profiles", "Main", "channel-rewards.json"),
    );
  });

  it("falls back to Documents, then Music, for alert media", () => {
    const documents = path.join("/Users", "tester", "Documents");
    expect(defaultAssetFolder(host("win32", { documents }))).toBe(path.join(documents, "Rascal-Assets", "Sounds"));
    expect(defaultAssetFolder(host("darwin"))).toBe(path.join("/Users", "tester", "Music", "Rascal-Assets", "Sounds"));
    expect(defaultAssetFolder(host("win32"))).toBe(path.join("/Users", "tester", "Music", "Rascal-Assets", "Sounds"));
  });

  it("builds a file URL without string-joining the path", () => {
    const url = fileUrl(path.join("/media", "my sounds", "clip.mp3"));
    expect(url.startsWith("file:")).toBe(true);
    expect(url).toContain("my%20sounds");
    expect(url.endsWith("clip.mp3")).toBe(true);
  });

  it("lets the desktop app install a host and then clear it", () => {
    const installed = host("darwin", { appData: path.join("/tmp", "appdata") });
    usePathHost(installed);
    expect(currentPathHost()).toBe(installed);
    expect(configDir()).toBe(path.join("/tmp", "appdata", "Rascal"));
    usePathHost(null);
    expect(currentPathHost().platform).toBe(process.platform);
  });
});

describe("icon source", () => {
  it("keeps the tabby svg as the mark the icon build reads", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const svg = readFileSync(path.join(root, "build", "icon.svg"), "utf8");
    expect(svg).toContain("#2B2B2B");
    expect(svg).toContain("#C48A4A");
    expect(svg.toLowerCase()).not.toMatch(/flame|ember/);
  });
});

describe("browser user agent", () => {
  it("keeps the Linux Chrome string and uses the host OS otherwise", () => {
    expect(browserUserAgent("linux")).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    expect(browserUserAgent("win32")).toContain("Windows NT 10.0");
    expect(browserUserAgent("darwin")).toContain("Macintosh");
    expect(browserUserAgent("freebsd")).toContain("X11; Linux x86_64");
  });
});
