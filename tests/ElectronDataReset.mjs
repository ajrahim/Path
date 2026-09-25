import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Requires the Electron build of better-sqlite3. All windows stay hidden and data is temporary.
const repository = fileURLToPath(new URL("../", import.meta.url));
const electron = createRequire(join(repository, "apps/desktop/package.json"))("electron");
const fixture = await mkdtemp(join(tmpdir(), "path-reset-"));
const bundleDirectory = join(repository, "node_modules/.cache/path-tests");
const bundleId = randomUUID();
const worker = join(bundleDirectory, `reset-worker-${bundleId}.cjs`);
const runner = join(bundleDirectory, `reset-runner-${bundleId}.cjs`);

await build({
  entryPoints: [join(repository, "apps/desktop/src/storage/DatabaseWorker.ts")],
  bundle: true,
  external: ["better-sqlite3"],
  format: "cjs",
  platform: "node",
  target: "node22",
  outfile: worker,
});

const source = `
import assert from "node:assert/strict";
import { app, BrowserWindow, protocol, session } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppDataReset } from "./apps/desktop/src/storage/AppDataReset";
import { DatabaseClient } from "./apps/desktop/src/storage/DatabaseClient";
import { userDataLayout } from "./apps/desktop/src/storage/UserDataDirectory";
const fixture = ${JSON.stringify(fixture)};
const layout = userDataLayout(join(fixture, "profile"));
mkdirSync(layout.userDataDirectory, { recursive: true });
app.setName("Path Reset Verification");
app.setPath("userData", layout.userDataDirectory);
protocol.registerSchemesAsPrivileged([{ scheme: "path", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
async function openDatabase() {
  return DatabaseClient.open({ workerPath: ${JSON.stringify(worker)}, databasePath: layout.databasePath, migrationsFolder: ${JSON.stringify(join(repository, "packages/database/drizzle"))} });
}
void app.whenReady().then(async () => {
  try {
    const reset = new AppDataReset(layout, openDatabase, session.defaultSession);
    await reset.completePending();
    protocol.handle("path", () => new Response("<html><body>Reset verification</body></html>", { headers: { "Content-Type": "text/html" } }));
    if (process.argv.includes("--verify-after-reset")) {
      const window = new BrowserWindow({ show: false });
      await window.loadURL("path://renderer/");
      assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('path.theme')"), null);
      assert.equal(existsSync(layout.credentialsPath), false);
      assert.equal(existsSync(join(fixture, "external", "3a5f9621-aac8-44a4-8c17-85e284d8a967")), false);
      assert.equal(existsSync(join(fixture, "external", "original.log")), true);
      const database = await openDatabase();
      assert.deepEqual(await database.repositories.recordings.list(), []);
      assert.equal(await database.repositories.appSettings.get("test-setting"), null);
      await database.close(5000);
      writeFileSync(join(fixture, "result.json"), JSON.stringify({ passed: true }));
      app.exit(0);
      return;
    }
    const window = new BrowserWindow({ show: false });
    await window.loadURL("path://renderer/");
    await window.webContents.executeJavaScript("localStorage.setItem('path.theme','dark')");
    session.defaultSession.flushStorageData();
    mkdirSync(join(layout.userDataDirectory, "credentials"), { recursive: true });
    writeFileSync(layout.credentialsPath, "fixture credential");
    const database = await openDatabase();
    const root = await database.repositories.storageRoots.register(join(fixture, "external"));
    const id = "3a5f9621-aac8-44a4-8c17-85e284d8a967";
    mkdirSync(join(root.path, id), { recursive: true });
    writeFileSync(join(root.path, id, "recording.mp4"), "fixture");
    writeFileSync(join(root.path, "original.log"), "preserve");
    await database.repositories.recordings.create({ id, storageRootId: root.id, title: "Fixture", captureMode: "display", startedAt: new Date().toISOString() });
    await database.repositories.appSettings.set("test-setting", "private");
    await database.close(5000);
    await reset.request();
    app.relaunch({ args: [${JSON.stringify(runner)}, "--verify-after-reset"] });
    app.quit();
  } catch (error) {
    writeFileSync(join(fixture, "result.json"), JSON.stringify({ passed: false, error: error.stack }));
    app.exit(1);
  }
});
`;

await build({
  stdin: { contents: source, resolveDir: repository, loader: "ts" },
  bundle: true,
  external: ["electron"],
  format: "cjs",
  platform: "node",
  target: "node22",
  outfile: runner,
});

const environment = { ...process.env };

delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [runner], {
  windowsHide: true,
  stdio: "ignore",
  env: environment,
});

let launchError;

child.on("error", (error) => {
  launchError = error;
});
let result;

for (let attempt = 0; attempt < 90; attempt++) {
  if (launchError) throw launchError;
  try {
    result = JSON.parse(await readFile(join(fixture, "result.json"), "utf8"));
    break;
  } catch {
    await delay(500);
  }
}

assert.ok(result, `Native reset timed out. Temporary profile retained at ${fixture}`);
await delay(500);
// Validate the final recursive-delete target before removing only this test's temporary profile.
assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
await rm(fixture, { recursive: true, force: true });
await rm(worker, { force: true });
await rm(runner, { force: true });
assert.equal(result.passed, true, result.error);
console.log(
  "Native restart, theme/storage reset, managed media deletion, and original preservation passed.",
);
