import os from "node:os";
import path from "node:path";
import { APP_NAME } from "../shared/defaults";

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, APP_NAME);
}
