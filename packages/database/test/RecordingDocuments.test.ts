import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, RecordingRepository, type DatabaseConnection } from "../src/index";
import type { ClickEvent } from "@path/shared";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

describe("recording guide documents", () => {
  let connection: DatabaseConnection;
  let recordings: RecordingRepository;

  beforeAll(() => {
    connection = openDatabase(":memory:", migrationsFolder);
    recordings = new RecordingRepository(connection.db);
  });

  afterAll(() => {
    connection.close();
  });

  it("returns no document before the first save", async () => {
    const session = await recordings.create({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Unsaved guide",
      captureMode: "display",
      startedAt: new Date().toISOString(),
    });

    await expect(recordings.getDocument(session.id)).resolves.toBeNull();
  });

  it("keeps one Markdown document per recording across saves", async () => {
    const session = await recordings.create({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Guide draft",
      captureMode: "display",
      startedAt: new Date().toISOString(),
    });

    await recordings.saveDocument(session.id, "# First");
    const saved = await recordings.saveDocument(session.id, "# Second");

    expect(saved.markdown).toBe("# Second");
    expect(saved.title).toBe("Guide draft");
    await expect(recordings.getDocument(session.id)).resolves.toMatchObject({
      recordingId: session.id,
      markdown: "# Second",
    });
  });

  it("rejects saving a document for an unknown recording", async () => {
    await expect(
      recordings.saveDocument("33333333-3333-4333-8333-333333333333", "# Missing"),
    ).rejects.toThrow("Recording not found");
  });

  it("updates a click description within its own recording", async () => {
    const session = await recordings.create({
      id: "44444444-4444-4444-8444-444444444444",
      title: "Click edits",
      captureMode: "display",
      startedAt: new Date().toISOString(),
    });

    const click: ClickEvent = {
      id: "55555555-5555-4555-8555-555555555555",
      recordingId: session.id,
      timestampMs: 1_000,
      button: "left",
      globalX: 10,
      globalY: 20,
      displayId: "1",
      displayX: 10,
      displayY: 20,
      captureX: null,
      captureY: null,
      videoX: null,
      videoY: null,
      normalizedX: null,
      normalizedY: null,
      recordingFrameWidth: null,
      recordingFrameHeight: null,
      insideCaptureRegion: true,
      screenshotPath: null,
      actionDescription: null,
      createdAt: new Date().toISOString(),
    };

    await recordings.insertClick(click);

    const updated = await recordings.updateClickDescription(session.id, click.id, "Open settings");

    expect(updated.actionDescription).toBe("Open settings");
    await expect(recordings.getClick(session.id, click.id)).resolves.toMatchObject({
      actionDescription: "Open settings",
    });
  });
});
