import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestRecording, openTestDatabase } from "./TestDatabase";

describe("ProjectRepository", () => {
  it("persists membership across restarts without changing recording content", () => {
    let database = openTestDatabase();
    const recordingId = createTestRecording(database);

    database.documents.save(recordingId, "# Keep this document", null, 0);

    const [first] = database.projects.change({ action: "create", name: "  Onboarding  " });
    const all = database.projects.change({ action: "create", name: "Reference" });
    const second = all.find((project) => project.id !== first!.id)!;

    database.projects.change({ action: "move", recordingId, projectId: first!.id });
    database.projects.change({ action: "move", recordingId, projectId: second.id });

    expect(database.projects.list().find((project) => project.id === first!.id)).toMatchObject({
      name: "Onboarding",
      recordingIds: [],
    });

    database.projects.change({ action: "rename", id: second.id, name: "Examples" });
    database.connection.close();
    database = openTestDatabase(database.databasePath);

    expect(database.projects.list()).toContainEqual({
      id: second.id,
      name: "Examples",
      recordingIds: [recordingId],
    });

    database.projects.change({ action: "remove", id: second.id });

    expect(database.recordings.get(recordingId)?.title).toBe("Recorded walkthrough");
    expect(database.documents.getSnapshot(recordingId).saved?.markdown).toBe(
      "# Keep this document",
    );

    database.projects.change({ action: "move", recordingId, projectId: first!.id });
    database.projects.change({ action: "move", recordingId, projectId: null });

    expect(database.projects.list()[0]?.recordingIds).toEqual([]);

    database.projects.change({ action: "move", recordingId, projectId: first!.id });
    database.recordings.delete(recordingId);

    expect(database.projects.list()[0]?.recordingIds).toEqual([]);

    database.connection.close();
  });

  it("rejects invalid names and missing destinations without losing existing membership", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    expect(() => database.projects.change({ action: "create", name: "   " })).toThrow();

    const [project] = database.projects.change({ action: "create", name: "Keep" });

    database.projects.change({ action: "move", recordingId, projectId: project!.id });

    expect(() =>
      database.projects.change({ action: "move", recordingId, projectId: randomUUID() }),
    ).toThrow("Project not found");
    expect(() =>
      database.projects.change({
        action: "move",
        recordingId: randomUUID(),
        projectId: project!.id,
      }),
    ).toThrow("Recording not found");
    expect(database.projects.list()[0]?.recordingIds).toEqual([recordingId]);

    database.connection.close();
  });
});
