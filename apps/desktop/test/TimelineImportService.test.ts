import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineImportService } from "../src/recording/TimelineImportService";
import {
  createStoppedRecording,
  openInProcessDatabase,
  type InProcessDatabase,
} from "./InProcessDatabase";

const databases: InProcessDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function createService(maxFileSizeMb = 10) {
  const database = openInProcessDatabase();

  databases.push(database);

  const recordingId = await createStoppedRecording(database, {
    pauses: [{ atMs: 10_000, durationMs: 5_000 }],
  });

  const settings = { get: () => ({ timelineImports: { maxFileSizeMb } }) };
  const service = new TimelineImportService(
    database.repositories,
    database.importer,
    settings as never,
  );

  return { service, database, recordingId };
}

async function writeImport(database: InProcessDatabase, name: string, content: string) {
  const path = join(database.directory, name);

  await writeFile(path, content, "utf8");

  return path;
}

const logContent = [
  "2026-09-14T09:59:59Z before the video",
  "2026-09-14T10:00:02Z Opened settings",
  "2026-09-14T10:00:12Z during the pause",
  "2026-09-14T10:00:20Z Saved profile",
  "    at save (profile.ts:4)",
  "2026-09-14T10:01:00Z after the video",
].join("\n");

describe("TimelineImportService", () => {
  it("imports a file and pages rows aligned to media time, excluding paused wall time", async () => {
    const { service, database, recordingId } = await createService();
    const path = await writeImport(database, "app.log", logContent);

    const result = await service.importFile(recordingId, "log", async () => path);

    expect(result).toMatchObject({
      status: "imported",
      timelineImport: {
        kind: "log",
        fileName: "app.log",
        offsetMs: 0,
        rowCount: 5,
        entryCount: 3,
        outsideCount: 2,
        unreadableLineCount: 0,
      },
    });

    const page = await service.listRows(recordingId, "log", 0, 50);

    expect(page.total).toBe(3);
    expect(page.entries.map((entry) => [entry.timestampMs, entry.text])).toEqual([
      [2_000, "Opened settings"],
      [10_000, "during the pause"],
      [15_000, "Saved profile\n    at save (profile.ts:4)"],
    ]);
  });

  it("re-aligns stored rows when the offset changes", async () => {
    const { service, database, recordingId } = await createService();
    const path = await writeImport(database, "app.log", logContent);

    await service.importFile(recordingId, "log", async () => path);
    const shifted = await service.updateOffset(recordingId, "log", 2_000);

    expect(shifted).toMatchObject({ offsetMs: 2_000, entryCount: 4, outsideCount: 1 });
    expect(
      (await service.listRows(recordingId, "log", 0, 50)).entries.map(
        (entry) => entry.text.split("\n")[0],
      ),
    ).toEqual(["before the video", "Opened settings", "during the pause", "Saved profile"]);
  });

  it("filters, pages, and locates rows at the playhead", async () => {
    const { service, database, recordingId } = await createService();
    const rows = Array.from(
      { length: 250 },
      (_, index) =>
        `2026-09-14T10:00:${String(Math.floor(index / 10)).padStart(2, "0")}.${String((index % 10) * 100).padStart(3, "0")}Z ${index % 5 === 0 ? "ERROR" : "info"} row ${index}`,
    );

    const path = await writeImport(database, "dense.log", rows.join("\n"));

    await service.importFile(recordingId, "log", async () => path);

    const second = await service.listRows(recordingId, "log", 100, 100);

    // 10:00:10.0 up to 10:00:15.0 fall inside the pause; the rest shift by 5 s afterwards.
    expect(second.total).toBe(250);
    expect(second.entries).toHaveLength(100);
    expect(second.entries[0]?.text).toBe("ERROR row 100");

    const errors = await service.listRows(recordingId, "log", 0, 10, "error");

    expect(errors.total).toBe(50);
    expect(errors.entries.every((entry) => entry.text.startsWith("ERROR"))).toBe(true);

    await expect(service.locateRow(recordingId, "log", 0)).resolves.toBe(0);
    await expect(service.locateRow(recordingId, "log", 4_950)).resolves.toBe(49);
    // Everything captured during the pause is shown at the pause point.
    await expect(service.locateRow(recordingId, "log", 10_000)).resolves.toBe(150);
    await expect(service.locateRow(recordingId, "log", 10_000, "error")).resolves.toBe(30);
  });

  it("rejects files above the configured size limit without reading them", async () => {
    const { service, database, recordingId } = await createService(1);
    const path = await writeImport(database, "large.log", "x".repeat(1024 * 1024 + 1));
    const importTimelineFile = vi.spyOn(database.importer, "importTimelineFile");

    await expect(service.importFile(recordingId, "log", async () => path)).resolves.toEqual({
      status: "too-large",
      maxFileSizeMb: 1,
    });
    expect(importTimelineFile).not.toHaveBeenCalled();
  });

  it("reports files without timestamped rows and canceled dialogs", async () => {
    const { service, database, recordingId } = await createService();
    const path = await writeImport(database, "notes.txt", "no timestamps here\nstill none");

    await expect(service.importFile(recordingId, "element", async () => path)).resolves.toEqual({
      status: "no-rows",
    });
    await expect(service.importFile(recordingId, "element", async () => null)).resolves.toEqual({
      status: "canceled",
    });
    await expect(service.list(recordingId)).resolves.toMatchObject({ element: null });
  });

  it("validates the recording before opening the file dialog", async () => {
    const chooseFile = vi.fn(async () => null);
    const { service, database } = await createService();
    const root = await database.repositories.storageRoots.register(database.directory);
    const capturingId = "4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01";

    await database.repositories.recordings.create({
      id: capturingId,
      storageRootId: root.id,
      title: "Still capturing",
      captureMode: "display",
      startedAt: "2026-09-14T09:59:58.000Z",
    });

    await expect(service.importFile(capturingId, "log", chooseFile)).rejects.toThrow(
      "no video duration",
    );
    await expect(service.list(capturingId)).resolves.toEqual({
      window: null,
      log: null,
      element: null,
    });
    expect(chooseFile).not.toHaveBeenCalled();
    await expect(
      service.importFile("5a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01", "log", chooseFile),
    ).rejects.toThrow("Recording not found");
  });

  it("gives generation evidence from the whole video, not only the loaded page", async () => {
    const { service, database, recordingId } = await createService();
    const logRows = Array.from(
      { length: 3_000 },
      (_, index) =>
        `2026-09-14T10:00:${String(Math.floor(index / 100)).padStart(2, "0")}.${String((index % 100) * 10).padStart(3, "0")}Z log ${index}`,
    );

    const logPath = await writeImport(database, "app.log", logRows.join("\n"));
    const elementPath = await writeImport(
      database,
      "elements.jsonl",
      [
        JSON.stringify({ timestamp: "2026-09-14T10:00:01Z", path: "Settings > Profile" }),
        JSON.stringify({ timestamp: "2026-09-14T10:00:25Z", path: "Settings > Save" }),
      ].join("\n"),
    );

    await service.importFile(recordingId, "log", async () => logPath);
    await service.importFile(recordingId, "element", async () => elementPath);

    // A renderer showing only the first page does not narrow the evidence.
    await service.listRows(recordingId, "log", 0, 20);

    const evidence = await service.documentEntries(recordingId, 200);
    const logEvidence = evidence.filter((entry) => entry.kind === "log");

    // Two sparse element rows keep their place beside 3,000 dense log rows.
    expect(evidence).toHaveLength(200);
    expect(evidence.filter((entry) => entry.kind === "element").map((entry) => entry.text)).toEqual(
      ["Settings > Profile", "Settings > Save"],
    );
    expect(logEvidence).toHaveLength(198);
    expect(logEvidence[0]?.text).toBe("log 0");
    expect(logEvidence.at(-1)?.timestampMs).toBeGreaterThan(24_000);

    const lists = await service.list(recordingId);

    expect(lists.window).toEqual({
      startedAt: "2026-09-14T10:00:00.000Z",
      endedAt: "2026-09-14T10:00:35.000Z",
    });
    expect(lists.element).toMatchObject({ entryCount: 2 });
  });
});
