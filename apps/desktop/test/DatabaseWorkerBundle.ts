import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

export const MIGRATIONS_FOLDER = join(repositoryRoot, "packages/database/drizzle");

/**
 * Bundles the real worker entry the same way `Build.mjs` does. The bundle lives under the
 * repository's module cache so its external `better-sqlite3` resolves to the test runtime's build.
 */
export async function buildDatabaseWorker(): Promise<string> {
  const outfile = join(
    repositoryRoot,
    "node_modules/.cache/path-tests",
    `database-worker-${process.pid}-${Date.now()}.cjs`,
  );

  await build({
    entryPoints: [join(repositoryRoot, "apps/desktop/src/storage/DatabaseWorker.ts")],
    bundle: true,
    external: ["better-sqlite3"],
    format: "cjs",
    outfile,
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });

  return outfile;
}

export function temporaryDirectory(): { path: string; remove(): void } {
  const path = mkdtempSync(join(tmpdir(), "path-worker-"));

  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}
