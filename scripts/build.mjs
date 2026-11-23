import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const pythonCandidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
const python = pythonCandidates.find((cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0);
if (!python) {
  console.error("Python is required to rasterize build/icon.svg.");
  process.exit(1);
}
const icons = spawnSync(python, ["scripts/render-icon.py"], { stdio: "inherit" });
if (icons.status !== 0) process.exit(icons.status ?? 1);

const tsc = path.join(root, "..", "node_modules", "typescript", "bin", "tsc");
const typecheck = spawnSync(process.execPath, [tsc, "--noEmit"], { stdio: "inherit" });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
  legalComments: "none",
};

await build({
  ...shared,
  entryPoints: ["src/main/index.ts"],
  outfile: "dist/main/index.cjs",
});

await build({
  ...shared,
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/preload/index.cjs",
});

await viteBuild({ configFile: "vite.config.ts" });
