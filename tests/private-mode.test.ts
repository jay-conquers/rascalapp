import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chmodPrivate } from "../src/shared/private-mode";

describe("private file mode", () => {
  it("applies 0600 on POSIX and does not chmod on Windows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rascal-mode-"));
    const file = path.join(dir, "tokens.json");
    fs.writeFileSync(file, "{}\n");
    if (process.platform !== "win32") fs.chmodSync(file, 0o640);
    const before = fs.statSync(file).mode & 0o777;
    expect(() => chmodPrivate(file, 0o600, "win32")).not.toThrow();
    expect(fs.statSync(file).mode & 0o777).toBe(before);
    if (process.platform === "win32") return;
    chmodPrivate(file, 0o600, "linux");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    chmodPrivate(dir, 0o700, "darwin");
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
});
