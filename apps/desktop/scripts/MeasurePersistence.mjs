// Measures local persistence workloads with the real desktop storage code.
//
//   npm run measure:persistence -- [--rows=1000000] [--revisions=1000] [--electron]
//
// Node runs need better-sqlite3 built for Node (`npm rebuild better-sqlite3`); Electron runs need
// it built for Electron (`npm run rebuild:native -w @path/desktop`). Data goes to a temporary
// directory that is removed afterwards; results print as JSON.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const argumentsByName = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [name, value = "true"] = argument.replace(/^--/, "").split("=");

    return [name, value];
  }),
);

const isElectron = argumentsByName.electron === "true";
const bundleDirectory = join(root, "node_modules/.cache/path-benchmark");
const dataDirectory = mkdtempSync(join(tmpdir(), "path-benchmark-"));

// Bundles live under the repository so their external native module resolves to its build.
const bundle = (entry, outfile) =>
  build({
    entryPoints: [entry],
    bundle: true,
    external: ["better-sqlite3", "electron"],
    format: "cjs",
    outfile,
    platform: "node",
    target: "node22",
    logLevel: "warning",
  });

try {
  const workerPath = join(bundleDirectory, "database-worker.cjs");
  const benchmarkPath = join(bundleDirectory, "persistence-benchmark.cjs");
  const output = join(dataDirectory, "results.json");

  await bundle(join(root, "apps/desktop/src/storage/DatabaseWorker.ts"), workerPath);
  await bundle(join(root, "apps/desktop/scripts/PersistenceBenchmark.mjs"), benchmarkPath);

  const options = {
    workerPath,
    migrationsFolder: join(root, "packages/database/drizzle"),
    databasePath: join(dataDirectory, "database.sqlite"),
    directory: dataDirectory,
    rows: Number(argumentsByName.rows ?? 1_000_000),
    revisions: Number(argumentsByName.revisions ?? 1_000),
    imageRevisions: Number(argumentsByName.imageRevisions ?? 100),
    output,
  };

  const executable = isElectron
    ? createRequire(join(root, "apps/desktop/package.json"))("electron")
    : process.execPath;

  const result = spawnSync(executable, [benchmarkPath], {
    env: { ...process.env, PATH_APP_BENCHMARK: JSON.stringify(options) },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`The benchmark exited with ${result.status ?? result.signal}`);
  }

  console.log(readFileSync(output, "utf8"));
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}
