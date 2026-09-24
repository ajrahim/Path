import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase, ProjectRepository, RecordingRepository } from "../src";

const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

describe("ProjectRepository", () => {
  it("upgrades an existing library and persists membership without changing recording content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "path-projects-"));
    const legacy = join(directory, "legacy");

    mkdirSync(join(legacy, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"));

    journal.entries = journal.entries.slice(0, 2);
    writeFileSync(join(legacy, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) {
      copyFileSync(join(migrations, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
    }

    const path = join(directory, "library.sqlite");
    let connection = openDatabase(path, legacy);
    const recordingId = randomUUID();

    try {
      const now = new Date().toISOString();

      // Seed with SQL matching the legacy schema; current repositories expect later columns.
      connection.db.run(sql`
        INSERT INTO recordings (id, title, status, capture_mode, started_at, created_at, updated_at)
        VALUES (${recordingId}, 'Original', 'ready', 'display', ${now}, ${now}, ${now})
      `);
      connection.db.run(sql`
        INSERT INTO documents (id, recording_id, title, format, language, markdown, created_at, updated_at)
        VALUES (${randomUUID()}, ${recordingId}, 'Original', 'help-guide', 'en', '# Keep this document', ${now}, ${now})
      `);
      connection.close();
      connection = openDatabase(path, migrations);
      const repository = new ProjectRepository(connection.db);
      const [first] = await repository.change({ action: "create", name: "  Onboarding  " });
      const all = await repository.change({ action: "create", name: "Reference" });
      const second = all.find((project) => project.id !== first!.id)!;

      await repository.change({ action: "move", recordingId, projectId: first!.id });
      await repository.change({ action: "move", recordingId, projectId: second.id });
      expect((await repository.list()).find((project) => project.id === first!.id)).toMatchObject({
        name: "Onboarding",
        recordingIds: [],
      });
      await repository.change({ action: "rename", id: second.id, name: "Examples" });
      connection.close();
      connection = openDatabase(path, migrations);
      const reopened = new ProjectRepository(connection.db);

      expect(await reopened.list()).toContainEqual({
        id: second.id,
        name: "Examples",
        recordingIds: [recordingId],
      });
      await reopened.change({ action: "remove", id: second.id });
      const remaining = new RecordingRepository(connection.db);

      expect((await remaining.get(recordingId))?.title).toBe("Original");
      expect((await remaining.getDocument(recordingId))?.markdown).toBe("# Keep this document");
      await reopened.change({ action: "move", recordingId, projectId: first!.id });
      await reopened.change({ action: "move", recordingId, projectId: null });
      expect((await reopened.list())[0]?.recordingIds).toEqual([]);
      await reopened.change({ action: "move", recordingId, projectId: first!.id });
      await remaining.delete(recordingId);
      expect((await reopened.list())[0]?.recordingIds).toEqual([]);
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid names and missing destinations without losing existing membership", async () => {
    const connection = openDatabase(":memory:", migrations);

    try {
      const repository = new ProjectRepository(connection.db);
      const recordingId = randomUUID();

      await new RecordingRepository(connection.db).create({
        id: recordingId,
        title: "Example",
        captureMode: "display",
        startedAt: new Date().toISOString(),
      });
      await expect(repository.change({ action: "create", name: "   " })).rejects.toThrow();
      const [project] = await repository.change({ action: "create", name: "Keep" });

      await repository.change({ action: "move", recordingId, projectId: project!.id });
      await expect(
        repository.change({ action: "move", recordingId, projectId: randomUUID() }),
      ).rejects.toThrow("Project not found");
      await expect(
        repository.change({ action: "move", recordingId: randomUUID(), projectId: project!.id }),
      ).rejects.toThrow("Recording not found");
      expect((await repository.list())[0]?.recordingIds).toEqual([recordingId]);
    } finally {
      connection.close();
    }
  });
});
