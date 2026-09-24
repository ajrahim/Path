import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredTimelineImport } from "@path/database";
import type { RecordingSession } from "@path/shared";
import { TimelineImportService } from "../src/recording/TimelineImportService";

const recordingId = "4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01";

const session: RecordingSession = {
  id: recordingId,
  title: "Walkthrough",
  status: "ready",
  captureMode: "display",
  durationMs: 30_000,
  thumbnailPath: null,
  startedAt: "2026-09-14T09:59:58.000Z",
  completedAt: "2026-09-14T10:00:40.000Z",
  createdAt: "2026-09-14T09:59:58.000Z",
  updatedAt: "2026-09-14T10:00:40.000Z",
  transcriptStatus: "ready",
  captureRegion: null,
  videoPath: null,
  audioPath: null,
  guideStatus: "none",
  mediaTiming: {
    startedAt: "2026-09-14T10:00:00.000Z",
    pauses: [{ atMs: 10_000, durationMs: 5_000 }],
  },
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "path-timeline-import-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function createService(recording: RecordingSession | null = session, maxFileSizeMb = 10) {
  const stored = new Map<string, StoredTimelineImport>();
  let nextId = 1;

  const recordings = {
    get: vi.fn().mockResolvedValue(recording),
    listClicks: vi.fn().mockResolvedValue([]),
  };

  const imports = {
    get: vi.fn(async (_id: string, kind: string) => stored.get(kind) ?? null),
    replace: vi.fn(
      async (input: {
        kind: "log" | "element";
        fileName: string;
        unreadableLineCount: number;
        rows: { occurredAtMs: number; text: string }[];
      }) => {
        const value: StoredTimelineImport = {
          kind: input.kind,
          fileName: input.fileName,
          offsetMs: 0,
          unreadableLineCount: input.unreadableLineCount,
          importedAt: "2026-09-14T11:00:00.000Z",
          rows: input.rows.map((row) => ({ ...row, id: nextId++ })),
        };

        stored.set(input.kind, value);

        return value;
      },
    ),
    updateOffset: vi.fn(async (_id: string, kind: string, offsetMs: number) => {
      const value = stored.get(kind);

      if (!value) throw new Error("missing");

      value.offsetMs = offsetMs;

      return value;
    }),
    remove: vi.fn(async (_id: string, kind: string) => {
      stored.delete(kind);
    }),
  };

  const settings = { get: () => ({ timelineImports: { maxFileSizeMb } }) };
  const service = new TimelineImportService(
    recordings as never,
    imports as never,
    settings as never,
  );

  return { service, recordings, imports };
}

async function writeImport(name: string, content: string): Promise<string> {
  const path = join(directory, name);

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
  it("imports a file and aligns rows to media time, excluding paused wall time", async () => {
    const { service, imports } = createService();
    const path = await writeImport("app.log", logContent);

    const result = await service.importFile(recordingId, "log", async () => path);

    expect(result.status).toBe("imported");
    if (result.status !== "imported") return;

    expect(result.timelineImport).toMatchObject({
      kind: "log",
      fileName: "app.log",
      offsetMs: 0,
      outsideCount: 2,
      unreadableLineCount: 0,
    });
    expect(result.timelineImport.entries.map((entry) => [entry.timestampMs, entry.text])).toEqual([
      [2_000, "Opened settings"],
      [10_000, "during the pause"],
      [15_000, "Saved profile\n    at save (profile.ts:4)"],
    ]);

    // Rows outside the video are stored so a later offset can bring them into range.
    expect(imports.replace.mock.calls[0]?.[0].rows).toHaveLength(5);
  });

  it("re-aligns stored rows when the offset changes", async () => {
    const { service } = createService();
    const path = await writeImport("app.log", logContent);

    await service.importFile(recordingId, "log", async () => path);
    const shifted = await service.updateOffset(recordingId, "log", 2_000);

    expect(shifted.offsetMs).toBe(2_000);
    expect(shifted.entries.map((entry) => entry.text.split("\n")[0])).toEqual([
      "before the video",
      "Opened settings",
      "during the pause",
      "Saved profile",
    ]);
    expect(shifted.outsideCount).toBe(1);
  });

  it("rejects files above the configured size limit without reading them", async () => {
    const { service, imports } = createService(session, 1);
    const path = await writeImport("large.log", "x".repeat(1024 * 1024 + 1));

    await expect(service.importFile(recordingId, "log", async () => path)).resolves.toEqual({
      status: "too-large",
      maxFileSizeMb: 1,
    });
    expect(imports.replace).not.toHaveBeenCalled();
  });

  it("reports files without timestamped rows and canceled dialogs", async () => {
    const { service, imports } = createService();
    const path = await writeImport("notes.txt", "no timestamps here\nstill none");

    await expect(service.importFile(recordingId, "element", async () => path)).resolves.toEqual({
      status: "no-rows",
    });
    await expect(service.importFile(recordingId, "element", async () => null)).resolves.toEqual({
      status: "canceled",
    });
    expect(imports.replace).not.toHaveBeenCalled();
  });

  it("validates the recording before opening the file dialog", async () => {
    const chooseFile = vi.fn(async () => null);
    const { service } = createService({ ...session, durationMs: null });

    await expect(service.importFile(recordingId, "log", chooseFile)).rejects.toThrow(
      "no video duration",
    );
    expect(chooseFile).not.toHaveBeenCalled();

    const missing = createService(null);

    await expect(missing.service.importFile(recordingId, "log", chooseFile)).rejects.toThrow(
      "Recording not found",
    );
  });

  it("estimates timing for older recordings from click times and labels it approximate", async () => {
    const { service, recordings } = createService({ ...session, mediaTiming: null });

    recordings.listClicks.mockResolvedValue([
      { createdAt: "2026-09-14T10:00:05.000Z", timestampMs: 4_000 },
    ]);

    const listed = await service.list(recordingId);

    expect(listed.window).toEqual({
      startedAt: "2026-09-14T10:00:01.000Z",
      endedAt: "2026-09-14T10:00:31.000Z",
      isApproximate: true,
    });
  });

  it("lists both kinds and supplies aligned rows for document generation", async () => {
    const { service } = createService();
    const logPath = await writeImport("app.log", logContent);
    const elementPath = await writeImport(
      "elements.jsonl",
      '{"timestamp": "2026-09-14T10:00:03Z", "path": "Header > #nav > .menu > #first"}',
    );

    await service.importFile(recordingId, "log", async () => logPath);
    await service.importFile(recordingId, "element", async () => elementPath);

    const listed = await service.list(recordingId);

    expect(listed.window?.isApproximate).toBe(false);
    expect(listed.log?.entries).toHaveLength(3);
    expect(listed.element?.entries[0]?.text).toBe("Header > #nav > .menu > #first");

    const documentEntries = await service.documentEntries(recordingId);

    expect(documentEntries).toContainEqual({
      kind: "element",
      timestampMs: 3_000,
      text: "Header > #nav > .menu > #first",
    });
    expect(documentEntries.filter((entry) => entry.kind === "log")).toHaveLength(3);

    await service.remove(recordingId, "log");

    expect((await service.list(recordingId)).log).toBeNull();
  });
});
