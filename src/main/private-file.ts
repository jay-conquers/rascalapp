import fs from "node:fs";
import path from "node:path";

export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

export function writePrivateJson(file: string, value: unknown): void {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    return null;
  }
}

export function tightenFile(file: string): void {
  try {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode !== 0o600) fs.chmodSync(file, 0o600);
  } catch {
    // Missing files are created on the next save.
  }
}
