import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

// Electron and native runtime dependencies stay external to the bundles. The database worker is
// a separate entry because it runs in its own thread and owns the SQLite connection.
await build({
  entryPoints: {
    main: "src/Main.ts",
    preload: "src/Preload.ts",
    "database-worker": "src/storage/DatabaseWorker.ts",
  },
  bundle: true,
  external: ["electron", "better-sqlite3", "ffmpeg-static", "uiohook-napi"],
  format: "cjs",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  sourcemap: true,
  target: "node24",
});
