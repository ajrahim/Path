import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

// Electron and native runtime dependencies stay external to the main/preload bundles.
await build({
  entryPoints: { main: "src/Main.ts", preload: "src/Preload.ts" },
  bundle: true,
  external: ["electron", "better-sqlite3", "ffmpeg-static", "uiohook-napi"],
  format: "cjs",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  sourcemap: true,
  target: "node24",
});
