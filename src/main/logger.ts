import fs from "node:fs";
import path from "node:path";
import { brand } from "../shared/brand";
import { redact } from "../shared/redact";
import { ensurePrivateDir } from "./private-file";

export class Logger {
  readonly lines: string[] = [];

  constructor(private file: string | null) {
    if (file) {
      try {
        ensurePrivateDir(path.dirname(file));
        fs.closeSync(fs.openSync(file, "a", 0o600));
        fs.chmodSync(file, 0o600);
      } catch {
        this.file = null;
      }
    }
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.write("info", message, extra);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.write("error", message, extra);
  }

  private write(level: string, message: string, extra?: Record<string, unknown>): void {
    const suffix = extra ? ` ${redact(safeJson(extra))}` : "";
    const line = `${new Date().toISOString()} ${brand.slug} ${level} ${redact(message)}${suffix}`;
    this.lines.push(line);
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
    if (!this.file) return;
    try {
      fs.appendFileSync(this.file, `${line}\n`);
    } catch {
      // A logging failure must not take chat down.
    }
  }
}

function safeJson(extra: Record<string, unknown>): string {
  try {
    return JSON.stringify(extra);
  } catch {
    return "{}";
  }
}
