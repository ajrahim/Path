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

  it("creates a named folder and reuses its current name case-insensitively", () => {
    const database = openTestDatabase();
    const firstRecordingId = createTestRecording(database);
    const secondRecordingId = createTestRecording(database);

    database.projects.moveToNamedProject(firstRecordingId, "  Tutorials  ");
    const [project] = database.projects.list();

    expect(project).toMatchObject({ name: "Tutorials", recordingIds: [firstRecordingId] });
    database.projects.change({ action: "rename", id: project!.id, name: "Examples" });
    database.projects.moveToNamedProject(secondRecordingId, "examples");
    database.projects.moveToNamedProject(secondRecordingId, "EXAMPLES");

    expect(database.projects.list()).toEqual([
      {
        id: project!.id,
        name: "Examples",
        recordingIds: expect.arrayContaining([firstRecordingId, secondRecordingId]),
      },
    ]);
    expect(database.projects.list()[0]?.recordingIds).toHaveLength(2);
    database.connection.close();
  });

  it("rejects ambiguous names without changing existing membership", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    database.projects.moveToNamedProject(recordingId, "Keep");
    database.projects.change({ action: "create", name: "Same" });
    database.projects.change({ action: "create", name: "same" });

    expect(() => database.projects.moveToNamedProject(recordingId, "SAME")).toThrow(
      "More than one folder",
    );
    expect(
      database.projects.list().find((project) => project.name === "Keep")?.recordingIds,
    ).toEqual([recordingId]);
    database.connection.close();
  });

  it("does not create an empty folder when the recording is missing or input is invalid", () => {
    const database = openTestDatabase();

    expect(() => database.projects.moveToNamedProject(randomUUID(), "Missing")).toThrow(
      "Recording not found",
    );
    expect(() => database.projects.moveToNamedProject("not-an-id", "Invalid")).toThrow();

    const recordingId = createTestRecording(database);

    expect(() => database.projects.moveToNamedProject(recordingId, "  ")).toThrow();
    expect(() => database.projects.moveToNamedProject(recordingId, "x".repeat(81))).toThrow();
    expect(database.projects.list()).toEqual([]);
    database.connection.close();
  });
});
