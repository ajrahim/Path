import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const nativePackage = require.resolve("better-sqlite3/package.json");
const prebuildInstall = require.resolve("prebuild-install/bin.js");

// The desktop process needs Electron's ABI, which differs from the host Node test runtime.
const child = spawn(
  process.execPath,
  [prebuildInstall, "--runtime=electron", "--target=42.9.3", "--force"],
  { cwd: dirname(nativePackage), stdio: "inherit" },
);

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
