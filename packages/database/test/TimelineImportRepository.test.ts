import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, RecordingRepository, TimelineImportRepository } from "../src";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function openRepositories() {
  const directory = join(tmpdir(), `path-${randomUUID()}`);

  temporaryDirectories.push(directory);

  // Use the committed migrations so repository behavior is checked against real persisted shape.
  const connection = openDatabase(
    join(directory, "database.sqlite"),
    fileURLToPath(new URL("../drizzle", import.meta.url)),
  );

  const recordings = new RecordingRepository(connection.db);
  const imports = new TimelineImportRepository(connection.db);
  const recordingId = randomUUID();

  await recordings.create({
    id: recordingId,
    title: "Imported evidence",
    captureMode: "display",
    startedAt: "2026-09-14T09:59:58.000Z",
  });

  return { connection, recordings, imports, recordingId };
}

describe("TimelineImportRepository", () => {
  it("stores rows in wall-clock order and replaces an earlier import of the same kind", async () => {
    const { connection, imports, recordingId } = await openRepositories();

    await imports.replace({
      recordingId,
      kind: "log",
      fileName: "old.log",
      unreadableLineCount: 0,
      rows: [{ occurredAtMs: 1, text: "old" }],
    });

    // Enough rows to span several insert batches.
    const rows = Array.from({ length: 2_500 }, (_, index) => ({
      occurredAtMs: 5_000 - index,
      text: `row ${index}`,
    }));

    const stored = await imports.replace({
      recordingId,
      kind: "log",
      fileName: "app.log",
      unreadableLineCount: 3,
      rows,
    });

    expect(stored).toMatchObject({
      kind: "log",
      fileName: "app.log",
      offsetMs: 0,
      unreadableLineCount: 3,
    });
    expect(stored.rows).toHaveLength(2_500);
    expect(stored.rows[0]).toMatchObject({ occurredAtMs: 2_501, text: "row 2499" });
    expect(stored.rows.at(-1)).toMatchObject({ occurredAtMs: 5_000, text: "row 0" });
    expect(stored.rows.some((row) => row.text === "old")).toBe(false);
    expect(await imports.get(recordingId, "element")).toBeNull();

    connection.close();
  });

  it("updates offsets, removes one kind, and cascades with the recording", async () => {
    const { connection, recordings, imports, recordingId } = await openRepositories();

    for (const kind of ["log", "element"] as const) {
      await imports.replace({
        recordingId,
        kind,
        fileName: `${kind}.txt`,
        unreadableLineCount: 0,
        rows: [{ occurredAtMs: 1_000, text: kind }],
      });
    }

    await expect(imports.updateOffset(recordingId, "log", -2_500)).resolves.toMatchObject({
      offsetMs: -2_500,
    });

    await imports.remove(recordingId, "log");

    expect(await imports.get(recordingId, "log")).toBeNull();
    expect((await imports.get(recordingId, "element"))?.rows).toHaveLength(1);
    await expect(imports.updateOffset(recordingId, "log", 0)).rejects.toThrow("No log import");

    await recordings.delete(recordingId);

    expect(await imports.get(recordingId, "element")).toBeNull();

    connection.close();
  });

  it("persists recording media timing for alignment", async () => {
    const { connection, recordings, recordingId } = await openRepositories();

    expect((await recordings.get(recordingId))?.mediaTiming).toBeNull();

    const timing = {
      startedAt: "2026-09-14T10:00:00.000Z",
      pauses: [{ atMs: 10_000, durationMs: 5_000 }],
    };

    await recordings.recordMediaTiming(recordingId, timing);

    expect((await recordings.get(recordingId))?.mediaTiming).toEqual(timing);
    await expect(recordings.recordMediaTiming(randomUUID(), timing)).rejects.toThrow(
      "Recording not found",
    );

    connection.close();
  });
});
