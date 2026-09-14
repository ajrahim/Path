import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, RecordingRepository } from "../src";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RecordingRepository", () => {
  it("persists, renames, lists, and deletes a recording", async () => {
    const directory = join(tmpdir(), `path-${randomUUID()}`);

    temporaryDirectories.push(directory);

    // Use the committed migrations so repository behavior is checked against real persisted shape.
    const connection = openDatabase(
      join(directory, "database.sqlite"),
      fileURLToPath(new URL("../drizzle", import.meta.url)),
    );

    const repository = new RecordingRepository(connection.db);
    const id = randomUUID();

    await repository.create({
      id,
      title: "Settings walkthrough",
      captureMode: "region",
      startedAt: "2026-08-23T10:00:00.000Z",
    });

    const renamed = await repository.rename(id, "GitHub settings walkthrough");

    await repository.markProcessing(id, 4_320, join(directory, "recording.webm"));
    await repository.markReady(id, "2026-08-23T10:00:04.320Z");

    // Click evidence and transcript edits share recording ownership but persist independently.
    const clickId = randomUUID();

    await repository.insertClick({
      id: clickId,
      recordingId: id,
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
    });

    const screenshotPath = join(directory, "click.png");

    await repository.updateClickScreenshot(clickId, screenshotPath);
    await repository.updateClickActionDescription(clickId, "Import button");
    await repository.markTranscriptProcessing(id, join(directory, "audio.wav"));

    const transcriptId = randomUUID();

    await repository.replaceTranscript(id, [
      { id: transcriptId, recordingId: id, startMs: 1_200, endMs: 2_050, text: "Open settings." },
    ]);
    await repository.markTranscriptReady(id);

    // Read back the joined lifecycle and activity metadata before exercising editor mutations.
    expect(renamed.title).toBe("GitHub settings walkthrough");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "ready",
      durationMs: 4_320,
      completedAt: "2026-08-23T10:00:04.320Z",
      transcriptStatus: "ready",
    });
    await expect(repository.listClicks(id)).resolves.toEqual([
      expect.objectContaining({
        id: clickId,
        timestampMs: 2_100,
        normalizedX: 0.5,
        screenshotPath,
        actionDescription: "Import button",
      }),
    ]);
    await expect(repository.listTranscript(id)).resolves.toEqual([
      { id: transcriptId, recordingId: id, startMs: 1_200, endMs: 2_050, text: "Open settings." },
    ]);

    await expect(
      repository.updateTranscript(id, transcriptId, "Open the application settings."),
    ).resolves.toMatchObject({
      id: transcriptId,
      text: "Open the application settings.",
      startMs: 1_200,
      endMs: 2_050,
    });

    await repository.deleteTranscript(id, transcriptId);
    await repository.deleteClick(id, clickId);

    await expect(repository.listTranscript(id)).resolves.toEqual([]);
    await expect(repository.listClicks(id)).resolves.toEqual([]);

    // Recovery must mark only unfinished work; the completed recording remains independently deletable.
    const unfinishedId = randomUUID();

    await repository.create({
      id: unfinishedId,
      title: "Interrupted recording",
      captureMode: "display",
      startedAt: "2026-08-23T10:05:00.000Z",
    });

    await expect(repository.listUnfinished()).resolves.toEqual([
      expect.objectContaining({ id: unfinishedId, status: "recording" }),
    ]);

    await repository.markUnfinishedFailed();

    await expect(repository.get(unfinishedId)).resolves.toMatchObject({
      status: "failed",
      transcriptStatus: "failed",
    });

    await repository.delete(id);

    await expect(repository.get(id)).resolves.toBeNull();

    connection.close();
  });
});
