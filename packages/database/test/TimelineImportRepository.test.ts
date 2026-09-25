import { describe, expect, it } from "vitest";
import { createTestRecording, openTestDatabase, type TestDatabase } from "./TestDatabase";

function importRows(
  database: TestDatabase,
  recordingId: string,
  rows: { occurredAtMs: number; text: string }[],
  kind: "log" | "element" = "log",
) {
  const importId = database.timelineImports.beginStaging(recordingId, kind, `${kind}.txt`);

  database.timelineImports.appendStagingRows(importId, rows);

  return database.timelineImports.promoteStaging(importId, 2);
}

describe("TimelineImportRepository", () => {
  it("keeps the previous import visible until a replacement is promoted", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);
    const previous = importRows(database, recordingId, [{ occurredAtMs: 1, text: "old" }]);
    const stagingId = database.timelineImports.beginStaging(recordingId, "log", "new.log");

    // Enough rows to span several insert batches.
    database.timelineImports.appendStagingRows(
      stagingId,
      Array.from({ length: 2_500 }, (_, index) => ({
        occurredAtMs: 5_000 - index,
        text: `row ${index}`,
      })),
    );

    expect(database.timelineImports.getReady(recordingId, "log")).toEqual(previous);

    const promoted = database.timelineImports.promoteStaging(stagingId, 3);

    expect(promoted).toMatchObject({
      id: stagingId,
      fileName: "new.log",
      offsetMs: 0,
      rowCount: 2_500,
      unreadableLineCount: 3,
    });

    const range = { importId: stagingId, startMs: 0, endMs: 10_000 };

    expect(database.timelineImports.countRows(range)).toBe(2_500);
    expect(database.timelineImports.listRows(range, 0, 2)).toEqual([
      expect.objectContaining({ occurredAtMs: 2_501, text: "row 2499" }),
      expect.objectContaining({ occurredAtMs: 2_502, text: "row 2498" }),
    ]);
    expect(database.timelineImports.countRows({ ...range, importId: previous.id })).toBe(0);

    database.connection.close();
  });

  it("discards an interrupted import at the next startup and keeps the earlier one", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);
    const previous = importRows(database, recordingId, [{ occurredAtMs: 1, text: "kept" }]);
    const stagingId = database.timelineImports.beginStaging(recordingId, "log", "crashed.log");

    database.timelineImports.appendStagingRows(stagingId, [{ occurredAtMs: 2, text: "partial" }]);
    database.connection.close();

    const reopened = openTestDatabase(database.databasePath);

    expect(reopened.timelineImports.discardAllStaging()).toBe(1);
    expect(reopened.timelineImports.getReady(recordingId, "log")).toEqual(previous);
    expect(() => reopened.timelineImports.promoteStaging(stagingId, 0)).toThrow("canceled");
    expect(reopened.timelineImports.countRows({ importId: stagingId, startMs: 0, endMs: 10 })).toBe(
      0,
    );

    reopened.connection.close();
  });

  it("cancels a staging import when its recording is deleted mid-import", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);
    const stagingId = database.timelineImports.beginStaging(recordingId, "element", "paths.txt");

    database.recordings.delete(recordingId);

    expect(() =>
      database.timelineImports.appendStagingRows(stagingId, [{ occurredAtMs: 1, text: "a" }]),
    ).toThrow("recording was removed");

    database.connection.close();
  });

  it("pages, filters, and counts rows inside an inclusive time range", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);
    const stored = importRows(
      database,
      recordingId,
      Array.from({ length: 100 }, (_, index) => ({
        occurredAtMs: index * 10,
        text: index % 10 === 0 ? `ERROR 100% failure_${index}` : `info ${index}`,
      })),
    );

    const range = { importId: stored.id, startMs: 100, endMs: 500 };

    expect(database.timelineImports.countRows(range)).toBe(41);
    expect(database.timelineImports.listRows(range, 40, 10)).toEqual([
      expect.objectContaining({ occurredAtMs: 500 }),
    ]);

    const errors = { ...range, query: "error" };

    expect(database.timelineImports.countRows(errors)).toBe(5);
    expect(database.timelineImports.listRows(errors, 1, 2).map((row) => row.occurredAtMs)).toEqual([
      200, 300,
    ]);

    // LIKE wildcards in the query are literal text.
    expect(database.timelineImports.countRows({ ...range, query: "100%" })).toBe(5);
    expect(database.timelineImports.countRows({ ...range, query: "failure_2" })).toBe(1);
    expect(database.timelineImports.countRows({ ...range, query: "_" })).toBe(5);

    database.connection.close();
  });

  it("samples evenly across the whole range, independent of any page", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);
    const stored = importRows(
      database,
      recordingId,
      Array.from({ length: 10_000 }, (_, index) => ({ occurredAtMs: index, text: `row ${index}` })),
    );

    const range = { importId: stored.id, startMs: 1_000, endMs: 8_999 };
    const sample = database.timelineImports.sampleRows(range, 200);

    expect(sample).toHaveLength(200);
    expect(sample[0]?.occurredAtMs).toBe(1_000);
    expect(sample.at(-1)?.occurredAtMs).toBeGreaterThan(8_900);
    expect(new Set(sample.map((row) => row.id)).size).toBe(200);

    // A range smaller than the limit returns every row.
    expect(database.timelineImports.sampleRows({ ...range, endMs: 1_009 }, 200)).toHaveLength(10);

    database.connection.close();
  });

  it("updates offsets, removes one kind, and cascades with the recording", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    importRows(database, recordingId, [{ occurredAtMs: 1_000, text: "log" }], "log");
    importRows(database, recordingId, [{ occurredAtMs: 1_000, text: "element" }], "element");

    expect(database.timelineImports.updateOffset(recordingId, "log", -2_500)).toMatchObject({
      offsetMs: -2_500,
    });

    database.timelineImports.remove(recordingId, "log");

    expect(database.timelineImports.getReady(recordingId, "log")).toBeNull();
    expect(database.timelineImports.getReady(recordingId, "element")?.rowCount).toBe(1);
    expect(() => database.timelineImports.updateOffset(recordingId, "log", 0)).toThrow(
      "No log import",
    );

    database.recordings.delete(recordingId);

    expect(database.timelineImports.getReady(recordingId, "element")).toBeNull();

    database.connection.close();
  });
});
