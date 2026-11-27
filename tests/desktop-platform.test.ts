import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brand } from "../src/shared/brand";
import {
  applicationMenu,
  applyDesktopShell,
  windowsAppUserModelId,
  type AppMenuEntry,
} from "../src/main/desktop-shell";
import { PAGE_CSP } from "../src/main/page-csp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function roles(entries: AppMenuEntry[] | undefined): string[] {
  return (entries ?? []).flatMap((entry) => (entry.role ? [entry.role] : []));
}

describe("desktop shell", () => {
  it("installs a macOS menu and leaves every other platform without one", () => {
    expect(applicationMenu("linux", "Rascal")).toBeNull();
    expect(applicationMenu("win32", "Rascal")).toBeNull();
    expect(applicationMenu("freebsd", "Rascal")).toBeNull();

    const menu = applicationMenu("darwin", "Rascal");
    expect(menu?.map((entry) => entry.label)).toEqual(["Rascal", "Edit", "Window"]);
    expect(roles(menu?.[0]?.submenu)).toEqual(["about", "services", "hide", "hideOthers", "unhide", "quit"]);
    expect(menu?.[0]?.submenu?.find((entry) => entry.role === "quit")?.accelerator).toBe("Command+Q");
    expect(roles(menu?.[1]?.submenu)).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
    expect(roles(menu?.[2]?.submenu)).toEqual(["minimize", "zoom", "front", "close"]);
    expect(JSON.stringify(menu)).not.toMatch(/jeeves/i);
  });

  it("sets the Windows taskbar id and clears the menu everywhere else", () => {
    const seen: { platform: string; ids: string[]; menu: Array<AppMenuEntry[] | null> }[] = [];
    for (const platform of ["linux", "win32", "darwin"] as const) {
      const ids: string[] = [];
      const menu: Array<AppMenuEntry[] | null> = [];
      applyDesktopShell(platform, brand.displayName, {
        setAppUserModelId: (id) => ids.push(id),
        setApplicationMenu: (template) => menu.push(template),
      });
      seen.push({ platform, ids, menu });
    }
    expect(seen.find((row) => row.platform === "linux")).toEqual({ platform: "linux", ids: [], menu: [null] });
    expect(seen.find((row) => row.platform === "win32")).toEqual({
      platform: "win32",
      ids: ["app.rascal.desktop"],
      menu: [null],
    });
    expect(windowsAppUserModelId("win32")).toBe(brand.appId);
    expect(windowsAppUserModelId("linux")).toBeNull();
    expect(windowsAppUserModelId("darwin")).toBeNull();
    const darwin = seen.find((row) => row.platform === "darwin");
    expect(darwin?.ids).toEqual([]);
    expect(darwin?.menu[0]?.[0]?.label).toBe("Rascal");

    const builder = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
    expect(builder).toContain(`appId: ${brand.appId}`);
    const main = readFileSync(path.join(root, "src/main/index.ts"), "utf8");
    expect(main).toContain("applyDesktopShell(process.platform, app.name");
    expect(main).toContain("Menu.setApplicationMenu(null)");
    expect(main).toContain("app.setAppUserModelId(id)");
    expect(main.indexOf("installDesktopShell()")).toBeLessThan(main.indexOf("await app.whenReady()"));
    expect(main.indexOf("installDesktopShell()")).toBeLessThan(main.indexOf("createWindow(runtime)"));
  });
});

describe("packaged page policy", () => {
  it("allows a blob audio element and keeps the existing restrictions", () => {
    expect(PAGE_CSP).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: http://127.0.0.1:* http://localhost:* https://static-cdn.jtvnw.net https://cdn.betterttv.net https://cdn.frankerfacez.com https://cdn.7tv.app https://yt3.ggpht.com https://yt3.googleusercontent.com https://i.ytimg.com https://lh3.googleusercontent.com https://files.kick.com https://kick.com",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "font-src 'self'",
      ].join("; "),
    );
    const sound = readFileSync(path.join(root, "src/renderer/chat-sound.ts"), "utf8");
    expect(sound).toContain("new Audio()");
    expect(sound).toContain("createObjectURL");
    const main = readFileSync(path.join(root, "src/main/index.ts"), "utf8");
    expect(main).toContain('"Content-Security-Policy": [PAGE_CSP]');
  });
});

describe("desk font", () => {
  it("leads with the system font and keeps the Linux fallbacks", () => {
    const css = readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
    expect(css).toContain(
      'font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "Liberation Sans", "DejaVu Sans", sans-serif;',
    );
    expect(css).toContain('font-family: "Noto Sans Mono", "DejaVu Sans Mono", ui-monospace, monospace;');
  });
});

describe("packaging scripts", () => {
  it("keeps the check matrix and AppImage artifact, and adds Windows and macOS packages", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["build:appimage"]).toBe("npm run build && electron-builder --linux AppImage --publish never");
    expect(pkg.scripts["build:win"]).toBe("npm run build && electron-builder --win nsis --publish never");
    expect(pkg.scripts["build:mac"]).toBe("npm run build && electron-builder --mac dmg --publish never");
    const workflow = readFileSync(path.join(root, ".github/workflows/appimage.yml"), "utf8");
    expect(workflow).toContain("os: [ubuntu-latest, windows-latest, macos-latest]");
    expect(workflow).toContain("name: Rascal-AppImage");
    expect(workflow).toContain("./scripts/build-appimage.sh");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("npm run build:win");
    expect(workflow).toContain("name: Rascal-Windows-NSIS");
    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("npm run build:mac");
    expect(workflow).toContain("name: Rascal-macOS-DMG");
    const builder = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/win:[\s\S]*arch:\s*\n\s*- x64/);
    expect(builder).toMatch(/mac:[\s\S]*arch:\s*\n\s*- x64\s*\n\s*- arm64/);
  });
});

describe("macOS icon", () => {
  it("writes the 1024px ic10 chunk into icon.icns", () => {
    const probe = spawnSync("python3", ["-c", ICNS_PROBE], { cwd: root, encoding: "utf8" });
    expect(probe.status, probe.stderr).toBe(0);
    const report = JSON.parse(probe.stdout) as {
      kinds: [number, string][];
      sizes: number[];
      linux: number[];
      samples: Record<string, number>;
      tags: string[];
      ic10: [number, number];
      usesSizes: boolean;
      usesWrite: boolean;
      omittedIc10: boolean;
      file: string;
    };
    expect(report.file).toBe("icon.icns");
    expect(report.kinds).toContainEqual([1024, "ic10"]);
    expect(report.sizes).toEqual([16, 32, 48, 64, 128, 256, 512, 1024]);
    expect(report.linux).toEqual([16, 32, 48, 64, 128, 256, 512]);
    expect(report.samples).toEqual({ "16": 6, "32": 6, "48": 4, "64": 4, "128": 3, "256": 2, "512": 2, "1024": 1 });
    expect(report.tags).toEqual(["icp4", "icp5", "ic11", "icp6", "ic12", "ic07", "ic08", "ic13", "ic09", "ic14", "ic10"]);
    expect(report.ic10).toEqual([1024, 1024]);
    expect(report.usesSizes).toBe(true);
    expect(report.usesWrite).toBe(true);
    expect(report.omittedIc10).toBe(true);
  });
});

const ICNS_PROBE = `
import importlib.util, inspect, json, struct, tempfile
from pathlib import Path

root = Path.cwd()
spec = importlib.util.spec_from_file_location("render_icon", root / "scripts" / "render-icon.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def read_chunks(data):
    if data[:4] != b"icns":
        raise SystemExit("missing icns magic")
    total = struct.unpack(">I", data[4:8])[0]
    if total != len(data):
        raise SystemExit("icns length does not match the file")
    pos = 8
    found = []
    while pos < len(data):
        tag = data[pos:pos + 4].decode("ascii")
        length = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        if length < 8 or pos + length > len(data):
            raise SystemExit("bad icns chunk")
        found.append((tag, data[pos + 8:pos + length]))
        pos += length
    if pos != len(data):
        raise SystemExit("icns chunks did not fill the file")
    return found

def ihdr(png):
    if png[:8] != b"\\x89PNG\\r\\n\\x1a\\n":
        raise SystemExit("ic10 payload is not a png")
    kind = png[12:16]
    if kind != b"IHDR":
        raise SystemExit("png is missing IHDR")
    return struct.unpack(">II", png[16:24])

pngs = {}
for size, _tag in mod.icns_kinds():
    pngs[size] = mod.png_bytes(size, bytes(size * size * 4))
out = Path(tempfile.mkdtemp()) / "icon.icns"
mod.write_icns(out, pngs)
chunks = read_chunks(out.read_bytes())
ic10 = [body for tag, body in chunks if tag == "ic10"]
if len(ic10) != 1:
    raise SystemExit("expected one ic10 chunk")
width, height = ihdr(ic10[0])
without = dict(pngs)
without.pop(1024)
omitted = Path(tempfile.mkdtemp()) / "icon.icns"
mod.write_icns(omitted, without)
omitted_tags = [tag for tag, _body in read_chunks(omitted.read_bytes())]
source = inspect.getsource(mod.main)
print(json.dumps({
    "kinds": [[size, tag.decode("ascii")] for size, tag in mod.icns_kinds()],
    "sizes": list(mod.sizes_to_render()),
    "linux": list(mod.linux_png_sizes()),
    "samples": {str(size): mod.samples_for(size) for size in (16, 32, 48, 64, 128, 256, 512, 1024)},
    "tags": [tag for tag, _body in chunks],
    "ic10": [width, height],
    "usesSizes": "sizes_to_render()" in source,
    "usesWrite": "write_icns(" in source,
    "omittedIc10": "ic10" not in omitted_tags,
    "file": out.name,
}))
`;
