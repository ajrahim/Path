import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetDeletionQueue } from "../src/storage/AssetDeletionQueue";
import { ManagedRecordingAssets } from "../src/storage/ManagedRecordingAssets";
import { openInProcessDatabase, type InProcessDatabase } from "./InProcessDatabase";

const databases: InProcessDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function setup() {
  const database = openInProcessDatabase();

  databases.push(database);

  const root = await database.repositories.storageRoots.register(join(database.directory, "media"));
  const assets = new ManagedRecordingAssets();

  await assets.useRoots(root, [root]);

  const diagnostics = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const queue = new AssetDeletionQueue(database.repositories.assetDeletions, assets, diagnostics);

  return { database, root, assets, diagnostics, queue };
}

async function createRecordingWithMedia(setupResult: Awaited<ReturnType<typeof setup>>) {
  const { database, root, assets } = setupResult;
  const id = crypto.randomUUID();
  const location = { recordingId: id, storageRootPath: root.path };

  await database.repositories.recordings.create({
    id,
    storageRootId: root.id,
    title: "To delete",
    captureMode: "display",
    startedAt: new Date().toISOString(),
  });
  await assets.createRecordingDirectory(location);
  writeFileSync(assets.finalVideoPath(location), "video");

  return { id, directory: assets.recordingDirectory(location) };
}

describe("AssetDeletionQueue", () => {
  it("removes a deleted recording's directory after its rows are gone", async () => {
    const context = await setup();
    const { id, directory } = await createRecordingWithMedia(context);

    await context.database.repositories.recordings.delete(id);
    expect(existsSync(directory)).toBe(true);

    await context.queue.process();

    expect(existsSync(directory)).toBe(false);
    await expect(context.database.repositories.assetDeletions.listPending(10)).resolves.toEqual([]);
  });

  it("keeps a failed deletion queued and completes it on a later run", async () => {
    const context = await setup();
    const { id, directory } = await createRecordingWithMedia(context);
    const remove = vi.spyOn(context.assets, "remove");

    // A player still holding the video on Windows makes removal fail with EBUSY.
    remove.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));
    await context.database.repositories.recordings.delete(id);
    await context.queue.process();

    expect(existsSync(directory)).toBe(true);
    await expect(context.database.repositories.assetDeletions.listPending(10)).resolves.toEqual([
      { path: directory, isDirectory: true, attemptCount: 1 },
    ]);
    expect(context.diagnostics.warn).toHaveBeenCalledOnce();

    await context.queue.process();

    expect(existsSync(directory)).toBe(false);
  });

  it("never deletes outside the managed roots and drops such an intent", async () => {
    const context = await setup();
    const outside = join(context.database.directory, "outside");
    const id = crypto.randomUUID();
    const foreignRoot = await context.database.repositories.storageRoots.register(outside);

    mkdirSync(join(outside, id), { recursive: true });
    await context.database.repositories.recordings.create({
      id,
      storageRootId: foreignRoot.id,
      title: "Unregistered in this session",
      captureMode: "display",
      startedAt: new Date().toISOString(),
    });
    await context.database.repositories.recordings.delete(id);
    await context.queue.process();

    expect(existsSync(join(outside, id))).toBe(true);
    expect(context.diagnostics.error).toHaveBeenCalledOnce();
    await expect(context.database.repositories.assetDeletions.listPending(10)).resolves.toEqual([]);
  });
});
