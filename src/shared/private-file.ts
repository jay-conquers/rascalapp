import fs from "node:fs";
import path from "node:path";
import { chmodPrivate } from "./private-mode.ts";

/** Create a directory at mode 0700. On Windows, chmod is skipped. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodPrivate(dir, 0o700);
}

/**
 * Write bytes to a temp file in the same directory, fsync, then rename.
 * The file and its directory are private on POSIX. Windows keeps the profile ACL.
 */
export function writePrivateBytes(file: string, data: string | NodeJS.ArrayBufferView): void {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    if (typeof data === "string") fs.writeSync(fd, data, "utf8");
    else fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  chmodPrivate(tmp, 0o600);
  fs.renameSync(tmp, file);
  chmodPrivate(file, 0o600);
}

export function writePrivateJson(file: string, value: unknown): void {
  writePrivateBytes(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function tightenFile(file: string): void {
  try {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode !== 0o600) chmodPrivate(file, 0o600);
  } catch {
    // Missing files are created on the next save.
  }
}
