import fs from "node:fs";
import { expect } from "vitest";

/** POSIX asserts the mode. Windows only checks that the file is there. */
export function expectPrivateMode(file: string, mode: number): void {
  expect(fs.existsSync(file)).toBe(true);
  if (process.platform === "win32") return;
  expect(fs.statSync(file).mode & 0o777).toBe(mode);
}
