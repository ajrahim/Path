import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClickEvent } from "@path/shared";
import { describe, expect, it } from "vitest";
import { createTestRecording, openTestDatabase } from "./TestDatabase";

function click(recordingId: string, overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    id: randomUUID(),
    recordingId,
    timestampMs: 2_100,
    button: "left",
    globalX: 600,
    globalY: 320,
    displayId: "1",
    displayX: 600,
    displayY: 320,
    captureX: 500,
    captureY: 220,
    videoX: 1_000,
    videoY: 440,
    normalizedX: 0.5,
    normalizedY: 0.4,
    recordingFrameWidth: 2_000,
    recordingFrameHeight: 1_100,
    insideCaptureRegion: true,
    screenshotPath: null,
    actionDescription: null,
    createdAt: "2026-08-23T10:00:02.100Z",
    ...overrides,
  };
}

describe("RecordingRepository", () => {
  it("persists lifecycle, activity, and edits across a restart", () => {
    const database = openTestDatabase();
    const rootPath = join("C:", "Recordings");
    const id = createTestRecording(database, { rootPath });

    database.recordings.rename(id, "GitHub settings walkthrough");
    database.recordings.recordMediaTiming(id, {
      startedAt: "2026-08-23T10:00:00.000Z",
      pauses: [{ atMs: 1_000, durationMs: 500 }],
    });
    database.recordings.markProcessing(id, 4_320, join(rootPath, id, "recording.webm"));
    database.recordings.markReady(id, "2026-08-23T10:00:04.320Z");

    const screenshotPath = join(rootPath, id, "screenshots", "click.png");
    const first = click(id, { screenshotPath });
    const second = click(id, { timestampMs: 3_000 });

    database.recordings.insertClicks([second, first]);
    database.recordings.updateClickActionDescription(first.id, "Import button");

    const transcriptId = randomUUID();

    database.recordings.replaceTranscript(id, [
      { id: transcriptId, recordingId: id, startMs: 1_200, endMs: 2_050, text: "Open settings." },
    ]);
    database.recordings.markTranscriptReady(id);
    database.connection.close();

    const reopened = openTestDatabase(database.databasePath);

    expect(reopened.recordings.get(id)).toMatchObject({
      title: "GitHub settings walkthrough",
      status: "ready",
      durationMs: 4_320,
      transcriptStatus: "ready",
      mediaTiming: {
        startedAt: "2026-08-23T10:00:00.000Z",
        pauses: [{ atMs: 1_000, durationMs: 500 }],
      },
    });
    expect(reopened.recordings.getAssetLocation(id)).toEqual({
      recordingId: id,
      storageRootPath: rootPath,
    });
    expect(reopened.recordings.listClicks(id).map((stored) => stored.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(reopened.recordings.getClick(id, first.id)?.actionDescription).toBe("Import button");
    expect(reopened.recordings.getClick(randomUUID(), first.id)).toBeNull();
    expect(reopened.recordings.updateTranscript(id, transcriptId, "Open app settings.").text).toBe(
      "Open app settings.",
    );

    reopened.connection.close();
  });

  it("replaces a transcript atomically and keeps the previous one when the write fails", () => {
    const database = openTestDatabase();
    const id = createTestRecording(database);
    const segment = { id: randomUUID(), recordingId: id, startMs: 0, endMs: 900, text: "First." };

    database.recordings.replaceTranscript(id, [segment]);

    // Duplicate IDs violate the primary key part-way through the replacement.
    const duplicate = { ...segment, text: "Replacement." };

    expect(() => database.recordings.replaceTranscript(id, [duplicate, duplicate])).toThrow();
    expect(database.recordings.listTranscript(id)).toEqual([segment]);

    database.connection.close();
  });

  it("stores a click batch all-or-nothing", () => {
    const database = openTestDatabase();
    const id = createTestRecording(database);
    const stored = click(id);

    database.recordings.insertClicks([stored]);

    expect(() => database.recordings.insertClicks([click(id), stored])).toThrow();
    expect(database.recordings.listClicks(id)).toHaveLength(1);

    database.connection.close();
  });

  it("queues asset deletion with the rows it removes", () => {
    const database = openTestDatabase();
    const rootPath = join("C:", "Recordings");
    const id = createTestRecording(database, { rootPath });
    const screenshotPath = join(rootPath, id, "screenshots", "click.png");
    const withScreenshot = click(id, { screenshotPath });

    database.recordings.insertClicks([withScreenshot]);
    database.recordings.deleteClick(id, withScreenshot.id);

    expect(() => database.recordings.deleteClick(id, withScreenshot.id)).toThrow(
      "Click event not found",
    );
    expect(database.assetDeletions.listPending(10)).toEqual([
      { path: screenshotPath, isDirectory: false, attemptCount: 0 },
    ]);

    database.assetDeletions.complete(screenshotPath);
    database.recordings.delete(id);

    expect(database.recordings.get(id)).toBeNull();
    expect(database.assetDeletions.listPending(10)).toEqual([
      { path: join(rootPath, id), isDirectory: true, attemptCount: 0 },
    ]);

    database.assetDeletions.recordFailedAttempt(join(rootPath, id));

    expect(database.assetDeletions.listPending(10)[0]?.attemptCount).toBe(1);

    database.connection.close();
  });

  it("fails interrupted captures and queues their incomplete media in one step", () => {
    const database = openTestDatabase();
    const rootPath = join("D:", "Previous root");
    const readyId = createTestRecording(database);
    const interruptedId = createTestRecording(database, { rootPath });

    database.recordings.markProcessing(readyId, 1_000, "recording.webm");
    database.recordings.markReady(readyId, "2026-08-23T10:00:04.320Z", "recording.mp4");

    expect(database.recordings.failUnfinished()).toEqual([
      { recordingId: interruptedId, storageRootPath: rootPath },
    ]);
    expect(database.recordings.get(interruptedId)).toMatchObject({
      status: "failed",
      transcriptStatus: "failed",
    });
    expect(database.recordings.get(readyId)?.status).toBe("ready");
    expect(database.assetDeletions.listPending(10).map((entry) => entry.path)).toEqual([
      join(rootPath, interruptedId),
    ]);
    expect(database.recordings.listReadyMedia()).toEqual([
      { id: readyId, videoPath: "recording.mp4" },
    ]);

    database.recordings.markFailed([readyId]);

    expect(database.recordings.listReadyMedia()).toEqual([]);

    database.connection.close();
  });

  it("keeps storage roots unique and rejects unknown recordings", () => {
    const database = openTestDatabase();
    const root = database.storageRoots.register(join("C:", "Recordings"));

    expect(database.storageRoots.register(join("C:", "Recordings"))).toEqual(root);
    expect(database.storageRoots.list()).toEqual([root]);
    expect(() => database.recordings.rename(randomUUID(), "Missing")).toThrow(
      "Recording not found",
    );
    expect(() => database.recordings.markProcessing(randomUUID(), 1, "x")).toThrow(
      "Recording not found",
    );

    database.connection.close();
  });
});
