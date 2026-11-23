import fs from "node:fs";

/**
 * Secret files are mode 0600, and the directories that hold them are mode 0700,
 * on POSIX (Linux and macOS).
 *
 * Windows has no Unix permission bits. Node's `fs.chmod` only toggles the
 * read-only attribute there, and it can throw `EPERM`. This function does not
 * call chmod on Windows, so saving a token cannot crash startup. Access control
 * is the ACL on the user profile (`%APPDATA%`, Documents, Music): that profile
 * is private to the account that owns it.
 */
export function chmodPrivate(target: string, mode: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") return;
  fs.chmodSync(target, mode);
}
