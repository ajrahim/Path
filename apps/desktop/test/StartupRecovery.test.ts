import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverRecordings } from "../src/recording/StartupRecovery";
import { ManagedRecordingAssets } from "../src/storage/ManagedRecordingAssets";
import { openInProcessDatabase, type InProcessDatabase } from "./InProcessDatabase";

const databases: InProcessDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("startup recovery", () => {
  it("fails interrupted captures and ready recordings without playable managed media", async () => {
    const database = openInProcessDatabase();

    databases.push(database);

    const { repositories } = database;
    const root = await repositories.storageRoots.register(join(database.directory, "media"));
    const assets = new ManagedRecordingAssets();

    await assets.useRoots(root, [root]);

    async function createRecording(video: "playable" | "empty" | "missing" | "outside" | null) {
      const id = crypto.randomUUID();
      const location = { recordingId: id, storageRootPath: root.path };

      await repositories.recordings.create({
        id,
        storageRootId: root.id,
        title: String(video),
        captureMode: "display",
        startedAt: new Date().toISOString(),
      });

      if (video === null) return id;

      await assets.createRecordingDirectory(location);

      const videoPath =
        video === "outside"
          ? join(database.directory, "outside.mp4")
          : assets.finalVideoPath(location);

      if (video !== "missing") {
        writeFileSync(videoPath, video === "empty" ? "" : Buffer.alloc(4_096));
      }

      await repositories.recordings.markProcessing(id, 1_000, videoPath);
      await repositories.recordings.markReady(id, new Date().toISOString(), videoPath);

      return id;
    }

    const playable = await createRecording("playable");
    const empty = await createRecording("empty");
    const missing = await createRecording("missing");
    const outside = await createRecording("outside");
    const interrupted = await createRecording(null);
    const diagnostics = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

    await expect(recoverRecordings(repositories.recordings, assets, diagnostics)).resolves.toEqual({
      interruptedCount: 1,
      missingMediaCount: 3,
    });

    const statuses = Object.fromEntries(
      (await repositories.recordings.list()).map((recording) => [recording.id, recording.status]),
    );

    expect(statuses).toEqual({
      [playable]: "ready",
      [empty]: "failed",
      [missing]: "failed",
      [outside]: "failed",
      [interrupted]: "failed",
    });
    await expect(repositories.assetDeletions.listPending(10)).resolves.toEqual([
      { path: join(root.path, interrupted), isDirectory: true, attemptCount: 0 },
    ]);

    // A second launch finds nothing left to recover.
    await expect(recoverRecordings(repositories.recordings, assets, diagnostics)).resolves.toEqual({
      interruptedCount: 0,
      missingMediaCount: 0,
    });
  });
});
