import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { AppDataReset } from "../src/storage/AppDataReset";
import { DatabaseClient } from "../src/storage/DatabaseClient";
import { ManagedRecordingAssets } from "../src/storage/ManagedRecordingAssets";
import { DesktopSettingsService } from "../src/settings/DesktopSettingsService";
import { InstructionFlowService } from "../src/settings/InstructionFlowService";
import { userDataLayout } from "../src/storage/UserDataDirectory";
import { buildDatabaseWorker, MIGRATIONS_FOLDER, temporaryDirectory } from "./DatabaseWorkerBundle";

let workerPath: string;
const cleanups: (() => void | Promise<void>)[] = [];

beforeAll(async () => {
  workerPath = await buildDatabaseWorker();
});
afterAll(() => rmSync(workerPath, { force: true }));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture() {
  const directory = temporaryDirectory();

  cleanups.push(directory.remove);
  const layout = userDataLayout(join(directory.path, "profile"));

  mkdirSync(layout.userDataDirectory);
  const openDatabase = vi.fn(async () => {
    const client = await DatabaseClient.open({
      workerPath,
      databasePath: layout.databasePath,
      migrationsFolder: MIGRATIONS_FOLDER,
    });

    cleanups.push(() => client.close(5_000));

    return client;
  });

  const clearBrowserData = vi.fn(async () => undefined);

  return {
    directory: directory.path,
    layout,
    openDatabase,
    clearBrowserData,
    reset: new AppDataReset(layout, openDatabase, {
      clearData: clearBrowserData,
      clearStorageData: vi.fn(async () => undefined),
      clearCache: vi.fn(async () => undefined),
      clearCodeCaches: vi.fn(async () => undefined),
      clearAuthCache: vi.fn(async () => undefined),
    }),
  };
}

function writeAsset(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "keep until explicitly cleared");
}

async function createRecording(database: DatabaseClient, root: string) {
  const storageRoot = await database.repositories.storageRoots.register(root);
  const id = randomUUID();

  await database.repositories.recordings.create({
    id,
    storageRootId: storageRoot.id,
    title: "Reset test",
    captureMode: "display",
    startedAt: new Date().toISOString(),
  });
  const asset = join(root, id, "recording.mp4");

  writeAsset(asset);

  return { id, asset };
}

it("leaves an ordinary startup untouched and only records a reset request until restart", async () => {
  const { layout, reset, openDatabase, clearBrowserData } = fixture();

  writeAsset(layout.credentialsPath);
  await reset.completePending();
  expect(openDatabase).not.toHaveBeenCalled();
  expect(clearBrowserData).not.toHaveBeenCalled();
  await reset.request();
  expect(readFileSync(layout.credentialsPath, "utf8")).toBe("keep until explicitly cleared");
  expect(existsSync(join(layout.userDataDirectory, ".reset-requested"))).toBe(true);
});

it("clears managed data in every storage root and recreates fresh defaults without deleting originals", async () => {
  const { directory, layout, reset, openDatabase, clearBrowserData } = fixture();
  const database = await openDatabase();
  const customRoot = join(directory, "custom-recordings");
  const local = await createRecording(database, layout.defaultRecordingsDirectory);
  const external = await createRecording(database, customRoot);
  const deleted = await createRecording(database, customRoot);

  await database.repositories.recordings.delete(deleted.id);
  await database.repositories.documents.saveDraft(local.id, "Private draft", 0);
  await database.repositories.projects.change({ action: "create", name: "Private project" });
  await database.repositories.appSettings.set("instruction-flows", { custom: "Private prompt" });
  const settings = new DesktopSettingsService(
    database.repositories,
    new ManagedRecordingAssets(),
    layout.defaultRecordingsDirectory,
    { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  );

  await settings.initialize();
  await settings.updateGeneral({ minimizeToTray: false });
  const original = join(customRoot, "original.log");
  const unrelated = join(customRoot, randomUUID(), "unrelated.mp4");

  writeAsset(original);
  writeAsset(unrelated);
  for (const name of ["credentials", "models", "logs", "cli-work", "backups"]) {
    writeAsset(join(layout.userDataDirectory, name, "saved-data"));
  }

  await database.close(5_000);

  await reset.request();
  await reset.completePending();
  expect(clearBrowserData).toHaveBeenCalledOnce();
  for (const asset of [local.asset, external.asset, deleted.asset, layout.databasePath]) {
    expect(existsSync(asset)).toBe(false);
  }

  expect(existsSync(original)).toBe(true);
  expect(existsSync(unrelated)).toBe(true);
  for (const name of ["credentials", "models", "logs", "cli-work", "backups", ".reset-requested"]) {
    expect(existsSync(join(layout.userDataDirectory, name))).toBe(false);
  }

  const fresh = await openDatabase();

  await expect(fresh.repositories.recordings.list()).resolves.toEqual([]);
  await expect(fresh.repositories.projects.list()).resolves.toEqual([]);
  await expect(fresh.repositories.appSettings.get("instruction-flows")).resolves.toBeNull();
  const freshSettings = new DesktopSettingsService(
    fresh.repositories,
    new ManagedRecordingAssets(),
    layout.defaultRecordingsDirectory,
    { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  );

  const freshPrompts = new InstructionFlowService(fresh.repositories.appSettings);

  await freshSettings.initialize();
  await freshPrompts.initialize();
  expect(freshSettings.get().general.minimizeToTray).toBe(true);
  expect(freshSettings.get().recordingsDirectory).toBe(layout.defaultRecordingsDirectory);
  expect(freshPrompts.get().customFlows).toEqual([]);
});

it("retains the request and database after a locked asset, then retries successfully", async () => {
  const { directory, layout, reset, openDatabase, clearBrowserData } = fixture();
  const database = await openDatabase();
  const { asset } = await createRecording(database, join(directory, "external"));

  await database.close(5_000);
  await reset.request();
  vi.spyOn(ManagedRecordingAssets.prototype, "remove").mockRejectedValueOnce(
    new Error("File locked"),
  );
  await expect(reset.completePending()).rejects.toThrow("File locked");
  expect(existsSync(layout.databasePath)).toBe(true);
  expect(existsSync(join(layout.userDataDirectory, ".reset-requested"))).toBe(true);
  expect(clearBrowserData).not.toHaveBeenCalled();
  await reset.completePending();
  expect(existsSync(asset)).toBe(false);
  expect(existsSync(layout.databasePath)).toBe(false);
});

it("retries a browser-storage failure and can clear a profile that has no database", async () => {
  const { layout, reset, clearBrowserData, openDatabase } = fixture();

  writeAsset(layout.credentialsPath);
  await reset.request();
  clearBrowserData.mockRejectedValueOnce(new Error("Storage busy"));
  await expect(reset.completePending()).rejects.toThrow("Storage busy");
  expect(existsSync(layout.credentialsPath)).toBe(true);
  await reset.completePending();
  expect(existsSync(layout.credentialsPath)).toBe(false);
  expect(openDatabase).not.toHaveBeenCalled();
});
