"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function pythonCommand() {
  const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return cmd;
  }
  return null;
}

function iconsReady() {
  const svg = path.join(root, "build", "icon.svg");
  const ico = path.join(root, "build", "icon.ico");
  const icns = path.join(root, "build", "icon.icns");
  if (!fs.existsSync(svg) || !fs.existsSync(ico) || !fs.existsSync(icns)) return false;
  const svgTime = fs.statSync(svg).mtimeMs;
  return fs.statSync(ico).mtimeMs >= svgTime && fs.statSync(icns).mtimeMs >= svgTime;
}

function generateIcons(force) {
  if (!force && iconsReady()) return;
  const py = pythonCommand();
  if (!py) {
    throw new Error("python3 is required to generate build/icon.ico and build/icon.icns from build/icon.svg");
  }
  const result = spawnSync(py, [path.join(root, "scripts", "render-icon.py")], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("Could not generate icons from build/icon.svg");
  }
}

async function beforePack() {
  generateIcons(false);
}

module.exports = beforePack;

if (require.main === module) {
  generateIcons(!process.argv.includes("--if-missing"));
}
