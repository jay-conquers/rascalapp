import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/** Value imports only. `import type` and `export type` do not pull a module in at runtime. */
function valueImports(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^(import|export)(?!\s+type\b)[^;]*?from "([^"]+)"/gm)].map((match) => match[2]);
}

describe("package boundaries", () => {
  it("the bot service does not import the desktop", () => {
    for (const file of sourceFiles("packages/bot/src")) {
      for (const spec of valueImports(file)) {
        expect(spec, file).not.toMatch(/src\/main|src\/renderer|"electron"/);
      }
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from "electron"/);
      expect(text, file).not.toMatch(/src\/main|src\/renderer/);
    }
  });

  it("shared code does not import the desktop or the bot at runtime", () => {
    for (const file of sourceFiles("src/shared")) {
      for (const spec of valueImports(file)) {
        expect(spec, file).not.toMatch(/src\/main|src\/renderer|packages\/bot|"electron"/);
      }
    }
  });

  it("the renderer does not import Electron or the desktop process", () => {
    for (const file of sourceFiles("src/renderer")) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from "electron"/);
      expect(text, file).not.toMatch(/from "[^"]*\/main\//);
    }
  });
});
