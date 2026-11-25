"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * The container starts as root so an existing volume can be handed to the
 * node user. The bot itself does not listen until that drop succeeds.
 */
function nodeAccount() {
  let text = "";
  try {
    text = fs.readFileSync("/etc/passwd", "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const parts = line.split(":");
    if (parts[0] === "node" && parts[2] && parts[3]) {
      return { uid: Number(parts[2]), gid: Number(parts[3]) };
    }
  }
  return null;
}

function tightenTree(dir, owner) {
  const root = path.resolve(dir);
  const visit = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return;
    const resolved = path.resolve(current);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
    if (stat.isDirectory()) {
      if (owner) fs.chownSync(current, owner.uid, owner.gid);
      fs.chmodSync(current, 0o700);
      for (const name of fs.readdirSync(current)) visit(path.join(current, name));
      return;
    }
    if (!stat.isFile()) return;
    if (owner) fs.chownSync(current, owner.uid, owner.gid);
    fs.chmodSync(current, 0o600);
  };
  visit(root);
}

function main() {
  const dir = process.env.RASCAL_BOT_DIR || "/data";
  fs.mkdirSync(dir, { recursive: true });
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    const account = nodeAccount();
    if (!account) {
      console.error("The image has no node user. Refusing to run the bot as root.");
      process.exit(1);
    }
    try {
      tightenTree(dir, account);
    } catch {
      console.error("Could not prepare the data directory before dropping root.");
      process.exit(1);
    }
    process.setgid(account.gid);
    process.setuid(account.uid);
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    console.error(`The bot cannot write ${dir}. Start the container as root once so it can hand the volume to the node user.`);
    process.exit(1);
  }
  require("./bot.cjs");
}

if (require.main === module) main();

module.exports = { tightenTree, nodeAccount };
