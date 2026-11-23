import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { build as viteBuild } from "vite";

const icons = spawnSync("python3", ["scripts/render-icon.py"], { stdio: "inherit" });
if (icons.status !== 0) process.exit(icons.status ?? 1);

const typecheck = spawnSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" });
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
