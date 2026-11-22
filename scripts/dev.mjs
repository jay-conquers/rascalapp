import { context } from "esbuild";
import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
  legalComments: "none",
};

const main = await context({ ...shared, entryPoints: ["src/main/index.ts"], outfile: "dist/main/index.cjs" });
const preload = await context({ ...shared, entryPoints: ["src/preload/index.ts"], outfile: "dist/preload/index.cjs" });
await main.rebuild();
await preload.rebuild();

const renderer = await createServer({ configFile: "vite.config.ts" });
await renderer.listen();

const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, RASCAL_RENDERER_URL: "http://127.0.0.1:5273" },
});

const shutdown = () => {
  child.kill("SIGTERM");
  void renderer.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", () => shutdown());

await main.watch();
await preload.watch();
